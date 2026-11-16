"""Durable, argument-free receipts for the isolated DEV tool gateway."""

from __future__ import annotations

import json
import os
from pathlib import Path
import threading
import time
from contextlib import contextmanager


_write_lock = threading.Lock()
_allowed_tools = frozenset({"dev_ping", "dev_echo", "dev_read_fixture"})


@contextmanager
def _exclusive_journal_lock(state: Path):
    """Serialize append and rollback across gateway processes on Windows and Unix."""
    fd = os.open(state / "tool-receipts.lock", os.O_RDWR | os.O_CREAT, 0o600)
    try:
        if os.name == "nt":
            import msvcrt

            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def record_tool_receipt(state: Path, receipt_id: str, tool_name: str, is_error: bool) -> None:
    """Append one complete receipt and sync it before acknowledging a tool result."""
    entry = json.dumps({
        "receipt_id": receipt_id,
        "tool": tool_name if tool_name in _allowed_tools else "unknown",
        "outcome": "error" if is_error else "completed",
        "timestamp": int(time.time()),
    }, separators=(",", ":")) + "\n"
    remaining = memoryview(entry.encode("utf-8"))
    # A partial append and any rollback must finish before another writer starts.
    with _write_lock:
        with _exclusive_journal_lock(state):
            fd = os.open(state / "tool-receipts.jsonl", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            try:
                original_size = os.fstat(fd).st_size
                try:
                    while remaining:
                        written = os.write(fd, remaining)
                        if written <= 0:
                            raise OSError("DEV tool receipt write made no progress")
                        remaining = remaining[written:]
                    os.fsync(fd)
                except OSError:
                    # Do not leave an incomplete record for the next process to read.
                    try:
                        os.ftruncate(fd, original_size)
                        os.fsync(fd)
                    except OSError:
                        pass
                    raise
            finally:
                os.close(fd)
