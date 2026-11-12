"""Create an isolated DEV gateway state directory without touching production state."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import secrets
import tempfile


def atomic_private_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--public-url", required=True)
    parser.add_argument("--port", type=int, default=28768)
    args = parser.parse_args()
    public = args.public_url.rstrip("/")
    if not public.startswith("https://"):
        raise SystemExit("DEV public URL must use HTTPS")
    if "codex-native2.continuos.com.br" in public.lower():
        raise SystemExit("Production hostname is forbidden for the DEV gateway")
    if not 1 <= args.port <= 65535:
        raise SystemExit("Port must be between 1 and 65535")
    state = Path(args.state_dir).expanduser().resolve()
    if state.exists() and any(state.iterdir()):
        raise SystemExit("Refusing to overwrite a non-empty DEV gateway state directory")
    state.mkdir(parents=True, exist_ok=True)
    (state / "fixtures").mkdir(exist_ok=True)
    config = {"public_url": public, "port": args.port}
    atomic_private_write(state / "config.json", json.dumps(config, indent=2) + "\n")
    pairing_key = secrets.token_urlsafe(36)
    atomic_private_write(state / "pairing.secret", pairing_key + "\n")
    atomic_private_write(
        state / "fixtures" / "hello.txt",
        "ContinuosWebIntegracao DEV fixture. Read-only test data; no production connection.\n",
    )
    print("DEV_GATEWAY_STATE_INITIALIZED")
    print(f"state_dir={state}")
    print(f"public_host={public.split('://', 1)[1]}")
    print(f"port={args.port}")
    print("pairing_secret_created=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
