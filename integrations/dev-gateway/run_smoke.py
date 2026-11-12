"""Start an ephemeral isolated DEV MCP server and exercise OAuth/PKCE end to end."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

import httpx


ROOT = Path(__file__).resolve().parent


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def remove_temporary_directory(path: Path) -> None:
    """Retry transient Windows file locks while removing isolated smoke state."""
    for attempt in range(8):
        try:
            shutil.rmtree(path)
            return
        except FileNotFoundError:
            return
        except PermissionError:
            if attempt == 7:
                raise
            time.sleep(0.25 * (attempt + 1))


def main() -> int:
    port = free_port()
    temporary = Path(tempfile.mkdtemp(prefix="codex-infinity-dev-gateway-"))
    server: subprocess.Popen | None = None
    try:
        state = temporary / "state"
        subprocess.run([
            sys.executable, str(ROOT / "init_state.py"),
            "--state-dir", str(state),
            "--public-url", "https://codex-native2-dev.continuos.com.br",
            "--port", str(port),
        ], check=True)
        env = os.environ.copy()
        env["CODEX_INFINITY_DEV_GATEWAY_STATE"] = str(state)
        server = subprocess.Popen(
            [sys.executable, str(ROOT / "server.py")],
            cwd=str(ROOT), env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            base = f"http://127.0.0.1:{port}"
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if server.poll() is not None:
                    raise RuntimeError(f"Isolated DEV gateway exited during startup ({server.returncode})")
                try:
                    response = httpx.get(base + "/health", timeout=1, trust_env=False)
                    if response.status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.2)
            else:
                raise RuntimeError("Isolated DEV gateway did not become healthy")
            subprocess.run([
                sys.executable, str(ROOT / "smoke_oauth.py"),
                "--base-url", base,
                "--state-dir", str(state),
            ], check=True, cwd=str(ROOT), env=env)
        finally:
            if server.poll() is None:
                server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)
    finally:
        remove_temporary_directory(temporary)
    print("DEV_GATEWAY_LOCAL_E2E_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
