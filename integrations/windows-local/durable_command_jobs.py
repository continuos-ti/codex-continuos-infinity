from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import time
import uuid
from ctypes import wintypes
from pathlib import Path
from typing import Any, Callable


_OPERATION_ID_PATTERN = re.compile(
    r"^(?:call_[A-Za-z0-9_-]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"
)
_OUTPUT_LIMIT = 64_000
_STARTUP_GRACE_SECONDS = 30


def _digest(command: str, cwd: str) -> str:
    payload = json.dumps(
        {"command": command, "cwd": cwd},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _read_tail(path: str | None) -> tuple[str, bool, bool]:
    if not path:
        return "", False, False

    try:
        size = os.path.getsize(path)
        with open(path, "rb") as stream:
            stream.seek(max(0, size - _OUTPUT_LIMIT))
            content = stream.read()
    except OSError:
        return "", False, False

    return content.decode("utf-8-sig", errors="replace"), size > _OUTPUT_LIMIT, True


def build_powershell_job_script(command: str, start_path: str, exit_path: str) -> str:
    start_encoded = base64.b64encode(start_path.encode("utf-16-le")).decode("ascii")
    exit_encoded = base64.b64encode(exit_path.encode("utf-16-le")).decode("ascii")
    command_script = "\n".join(
        [
            "$ProgressPreference = 'SilentlyContinue'",
            "$ErrorActionPreference = 'Stop'",
            "$global:LASTEXITCODE = 0",
            "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
            command,
            "if ($LASTEXITCODE -is [int]) { exit $LASTEXITCODE }",
        ]
    )
    command_encoded = base64.b64encode(command_script.encode("utf-16-le")).decode("ascii")
    return "\n".join(
        [
            "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
            "$__codexStartPath = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('" + start_encoded + "'))",
            "$__codexExitPath = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('" + exit_encoded + "'))",
            "$__codexCommand = '" + command_encoded + "'",
            "$__codexPowerShell = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
            "$__codexExitCode = 0",
            "try {",
            "    $__codexStart = [ordered]@{ pid = $PID; process_created_filetime = [System.Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToFileTimeUtc() }",
            "    [System.IO.File]::WriteAllText($__codexStartPath, (ConvertTo-Json -InputObject $__codexStart -Compress))",
            "    & $__codexPowerShell -NoProfile -NonInteractive -EncodedCommand $__codexCommand",
            "    $__codexExitCode = $LASTEXITCODE",
            "} catch {",
            "    [Console]::Error.WriteLine($_.Exception.Message)",
            "    $__codexExitCode = 1",
            "} finally {",
            "    [System.IO.File]::WriteAllText($__codexExitPath, [string]$__codexExitCode)",
            "}",
            "exit $__codexExitCode",
        ]
    )


def _filetime_value(value: wintypes.FILETIME) -> int:
    return (value.dwHighDateTime << 32) | value.dwLowDateTime


def probe_windows_process(pid: int, expected_creation_filetime: int) -> str:
    if os.name != "nt":
        return "unknown"

    process_query_limited_information = 0x1000
    synchronize = 0x00100000
    wait_object_0 = 0
    wait_timeout = 0x00000102

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.GetProcessTimes.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(wintypes.FILETIME),
        ctypes.POINTER(wintypes.FILETIME),
        ctypes.POINTER(wintypes.FILETIME),
        ctypes.POINTER(wintypes.FILETIME),
    ]
    kernel32.GetProcessTimes.restype = wintypes.BOOL
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    handle = kernel32.OpenProcess(
        process_query_limited_information | synchronize,
        False,
        pid,
    )
    if not handle:
        return "unknown"

    try:
        creation = wintypes.FILETIME()
        exit_time = wintypes.FILETIME()
        kernel_time = wintypes.FILETIME()
        user_time = wintypes.FILETIME()
        if not kernel32.GetProcessTimes(
            handle,
            ctypes.byref(creation),
            ctypes.byref(exit_time),
            ctypes.byref(kernel_time),
            ctypes.byref(user_time),
        ):
            return "unknown"

        if _filetime_value(creation) != expected_creation_filetime:
            return "unknown"

        wait_result = kernel32.WaitForSingleObject(handle, 0)
        if wait_result == wait_timeout:
            return "running"
        if wait_result == wait_object_0:
            return "unknown"
        return "unknown"
    finally:
        kernel32.CloseHandle(handle)


class DurableCommandJobs:
    """Durable idempotency and status ledger for Windows Local PowerShell jobs."""

    def __init__(
        self,
        state_dir: str | Path,
        process_probe: Callable[[int, int], str] | None = None,
        startup_grace_seconds: int = _STARTUP_GRACE_SECONDS,
    ) -> None:
        self.state_dir = Path(state_dir)
        self.jobs_dir = self.state_dir / "command-jobs"
        self.database_path = self.state_dir / "command-jobs.sqlite3"
        self.process_probe = process_probe or probe_windows_process
        self.startup_grace_seconds = startup_grace_seconds
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        return connection

    def _initialize(self) -> None:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS ledger_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS command_jobs (
                    operation_id TEXT PRIMARY KEY,
                    args_digest TEXT NOT NULL,
                    status TEXT NOT NULL,
                    pid INTEGER,
                    process_created_filetime INTEGER,
                    stdout_path TEXT,
                    stderr_path TEXT,
                    start_path TEXT NOT NULL,
                    exit_path TEXT NOT NULL,
                    exit_code INTEGER,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS screenshots (
                    screenshot_id TEXT PRIMARY KEY,
                    captured_at REAL NOT NULL,
                    left INTEGER NOT NULL,
                    top INTEGER NOT NULL,
                    sx REAL NOT NULL,
                    sy REAL NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    foreground TEXT NOT NULL
                )
                """
            )
            row = connection.execute(
                "SELECT value FROM ledger_meta WHERE key = 'provider_epoch'"
            ).fetchone()
            if row is None:
                self.epoch = uuid.uuid4().hex
                connection.execute(
                    "INSERT INTO ledger_meta (key, value) VALUES ('provider_epoch', ?)",
                    (self.epoch,),
                )
            else:
                self.epoch = str(row["value"])
                if not re.fullmatch(r"[0-9a-f]{32}", self.epoch):
                    raise RuntimeError("Windows Local operation ledger has an invalid provider epoch")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _load(self, operation_id: str) -> dict[str, Any] | None:
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT * FROM command_jobs WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            return dict(row) if row is not None else None
        finally:
            connection.close()

    def reserve(
        self,
        operation_id: str | None,
        provider_epoch: str | None,
        command: str,
        cwd: str,
    ) -> tuple[dict[str, Any], bool]:
        identifier = operation_id or str(uuid.uuid4())
        if not _OPERATION_ID_PATTERN.fullmatch(identifier):
            raise ValueError("operation_id has an unsupported format")
        if provider_epoch is not None and provider_epoch != self.epoch:
            raise ValueError("Windows Local provider epoch changed. The command was not started.")

        args_digest = _digest(command, cwd)
        job_dir = self.jobs_dir / identifier
        start_path = job_dir / "start.json"
        exit_path = job_dir / "exit_code.txt"
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM command_jobs WHERE operation_id = ?",
                (identifier,),
            ).fetchone()
            if row is not None:
                if row["args_digest"] != args_digest:
                    raise ValueError("operation_id was already used with different command arguments")
                connection.commit()
                return dict(row), False

            if job_dir.exists():
                raise RuntimeError("An orphaned operation directory exists. Refusing to reuse its operation_id.")

            job_dir.mkdir(parents=True, exist_ok=False)
            now = time.time()
            connection.execute(
                """
                INSERT INTO command_jobs (
                    operation_id, args_digest, status, pid,
                    process_created_filetime, stdout_path, stderr_path,
                    start_path, exit_path, exit_code, created_at, updated_at
                ) VALUES (?, ?, 'starting', NULL, NULL, NULL, NULL, ?, ?, NULL, ?, ?)
                """,
                (identifier, args_digest, str(start_path), str(exit_path), now, now),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

        record = self._load(identifier)
        if record is None:
            raise RuntimeError("The durable command operation was not committed")
        return record, True

    def set_output_paths(self, operation_id: str, stdout_path: str, stderr_path: str) -> None:
        connection = self._connect()
        try:
            connection.execute(
                """
                UPDATE command_jobs
                SET stdout_path = ?, stderr_path = ?, updated_at = ?
                WHERE operation_id = ?
                """,
                (stdout_path, stderr_path, time.time(), operation_id),
            )
            connection.commit()
        finally:
            connection.close()

    def save_screenshot(self, screenshot_id: str, shot: dict[str, Any]) -> None:
        try:
            uuid.UUID(screenshot_id)
            captured_at = float(shot["captured_at"])
            left = int(shot["left"])
            top = int(shot["top"])
            sx = float(shot["sx"])
            sy = float(shot["sy"])
            width = int(shot["width"])
            height = int(shot["height"])
            foreground = str(shot["foreground"])
        except (ValueError, TypeError, KeyError) as error:
            raise ValueError("Invalid durable screenshot metadata") from error

        if sx <= 0 or sy <= 0 or width <= 0 or height <= 0 or not foreground:
            raise ValueError("Invalid durable screenshot dimensions or foreground")

        connection = self._connect()
        try:
            connection.execute(
                """
                INSERT OR REPLACE INTO screenshots (
                    screenshot_id, captured_at, left, top, sx, sy,
                    width, height, foreground
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (screenshot_id, captured_at, left, top, sx, sy, width, height, foreground),
            )
            connection.commit()
        finally:
            connection.close()

    def load_screenshot(self, screenshot_id: str) -> dict[str, Any] | None:
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT * FROM screenshots WHERE screenshot_id = ?",
                (screenshot_id,),
            ).fetchone()
            return dict(row) if row is not None else None
        finally:
            connection.close()

    def delete_screenshot(self, screenshot_id: str) -> None:
        connection = self._connect()
        try:
            connection.execute(
                "DELETE FROM screenshots WHERE screenshot_id = ?",
                (screenshot_id,),
            )
            connection.commit()
        finally:
            connection.close()

    def clear_screenshots(self) -> None:
        connection = self._connect()
        try:
            connection.execute("DELETE FROM screenshots")
            connection.commit()
        finally:
            connection.close()

    def mark_started(self, operation_id: str, pid: int) -> None:
        connection = self._connect()
        try:
            connection.execute(
                """
                UPDATE command_jobs
                SET pid = ?, status = 'running', updated_at = ?
                WHERE operation_id = ? AND status IN ('starting', 'running')
                """,
                (pid, time.time(), operation_id),
            )
            connection.commit()
        finally:
            connection.close()

    def mark_launch_failed(self, operation_id: str) -> None:
        connection = self._connect()
        try:
            connection.execute(
                """
                UPDATE command_jobs
                SET status = 'launch_failed', updated_at = ?
                WHERE operation_id = ? AND status = 'starting'
                """,
                (time.time(), operation_id),
            )
            connection.commit()
        finally:
            connection.close()

    def _mark_completed(self, operation_id: str, exit_code: int) -> None:
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT exit_code FROM command_jobs WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            if row is None:
                raise ValueError("Unknown operation_id")
            previous = row["exit_code"]
            if previous is not None and int(previous) != exit_code:
                raise RuntimeError("Conflicting exit codes were reported for one operation_id")
            connection.execute(
                """
                UPDATE command_jobs
                SET status = 'completed', exit_code = ?, updated_at = ?
                WHERE operation_id = ?
                """,
                (exit_code, time.time(), operation_id),
            )
            connection.commit()
        finally:
            connection.close()

    @staticmethod
    def _read_start_marker(path: str) -> tuple[int, int] | None:
        try:
            with open(path, "r", encoding="utf-8") as stream:
                marker = json.load(stream)
            pid = int(marker["pid"])
            created = int(marker["process_created_filetime"])
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            return None
        if pid <= 0 or created <= 0:
            return None
        return pid, created

    @staticmethod
    def _read_exit_marker(path: str) -> int | None:
        try:
            with open(path, "r", encoding="ascii") as stream:
                return int(stream.read().strip())
        except (OSError, ValueError):
            return None

    def observe(
        self,
        operation_id: str,
        provider_epoch: str | None = None,
        process: Any = None,
        wait_seconds: int = 0,
    ) -> dict[str, Any]:
        if provider_epoch is not None and provider_epoch != self.epoch:
            return {
                "operation_id": operation_id,
                "provider_epoch": self.epoch,
                "status": "provider_changed",
                "exit_code": None,
                "message": "The Windows Local operation ledger changed since this operation was created.",
            }

        record = self._load(operation_id)
        if record is None:
            return {
                "operation_id": operation_id,
                "provider_epoch": self.epoch,
                "status": "not_found" if provider_epoch is not None else "epoch_required",
                "exit_code": None,
                "message": (
                    "No matching operation record exists in the current ledger. This does not prove that an older operation never ran."
                    if provider_epoch is not None
                    else "provider_epoch is required to reconcile an operation that is not in the current process memory."
                ),
            }

        if record["status"] in {"completed", "launch_failed"}:
            return record

        if process is not None:
            try:
                process.wait(timeout=max(0, min(int(wait_seconds), 30)))
            except subprocess.TimeoutExpired:
                pass
            exit_code = process.poll()
            if exit_code is not None:
                self._mark_completed(operation_id, int(exit_code))
                return self._load(operation_id) or record

        exit_code = self._read_exit_marker(record["exit_path"])
        if exit_code is not None:
            self._mark_completed(operation_id, exit_code)
            return self._load(operation_id) or record

        marker = self._read_start_marker(record["start_path"])
        if marker is not None:
            pid, created = marker
            connection = self._connect()
            try:
                connection.execute(
                    """
                    UPDATE command_jobs
                    SET pid = ?, process_created_filetime = ?, updated_at = ?
                    WHERE operation_id = ?
                    """,
                    (pid, created, time.time(), operation_id),
                )
                connection.commit()
            finally:
                connection.close()

            if self.process_probe(pid, created) == "running":
                record = self._load(operation_id) or record
                record["status"] = "running"
                return record

            record = self._load(operation_id) or record
            record["status"] = "unknown"
            record["message"] = "The process is no longer verifiably running and no durable exit code was recorded."
            return record

        age = time.time() - float(record["created_at"])
        if record["status"] == "starting" and age <= self.startup_grace_seconds:
            record["message"] = "The operation was reserved and its process start has not yet been observed."
            return record

        record["status"] = "unknown"
        record["message"] = "The operation was reserved, but its process start and completion could not be verified."
        return record

    def result(
        self,
        operation_id: str,
        provider_epoch: str | None = None,
        process: Any = None,
        wait_seconds: int = 0,
    ) -> dict[str, Any]:
        record = self.observe(operation_id, provider_epoch, process, wait_seconds)
        status = record["status"]
        stdout, stdout_truncated, stdout_available = _read_tail(record.get("stdout_path"))
        stderr, stderr_truncated, stderr_available = _read_tail(record.get("stderr_path"))
        return {
            "job_id": operation_id,
            "operation_id": operation_id,
            "provider_epoch": record.get("provider_epoch", self.epoch),
            "status": status,
            "running": status in {"starting", "running"},
            "exit_code": record.get("exit_code"),
            "stdout": stdout,
            "stderr": stderr,
            "stdout_truncated": stdout_truncated,
            "stderr_truncated": stderr_truncated,
            "output_available": stdout_available or stderr_available,
            "message": record.get("message"),
        }
