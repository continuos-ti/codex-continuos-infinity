"""Local OAuth/PKCE + Streamable HTTP smoke for the isolated DEV gateway."""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
from urllib.parse import parse_qs, urljoin, urlparse

import httpx


def require(condition: bool, stage: str, status: int | None = None) -> None:
    if not condition:
        suffix = f" (HTTP {status})" if status is not None else ""
        raise RuntimeError(f"DEV OAuth smoke failed at {stage}{suffix}")


def existing_smoke_client(state: Path) -> dict | None:
    """Reuse one isolated test DCR client and prune duplicate clients from earlier smoke runs."""
    database = state / "oauth.sqlite"
    if not database.is_file():
        return None
    db = sqlite3.connect(database, timeout=10)
    try:
        rows = db.execute("SELECT key,data FROM entries WHERE kind='client'").fetchall()
        candidates = []
        for key, raw in rows:
            data = json.loads(raw)
            if data.get("client_name") == "ContinuosWebIntegracao DEV smoke":
                candidates.append((key, data))
        if not candidates:
            return None
        chosen = next((item for item in candidates if db.execute(
            "SELECT 1 FROM entries WHERE kind='trusted_consent' AND key=?", (item[0],)
        ).fetchone()), candidates[0])
        chosen_id, chosen_data = chosen
        for client_id, _ in candidates:
            if client_id == chosen_id:
                continue
            db.execute("DELETE FROM entries WHERE kind='client' AND key=?", (client_id,))
            db.execute("DELETE FROM entries WHERE kind='trusted_consent' AND key=?", (client_id,))
            for kind, key, raw in db.execute(
                "SELECT kind,key,data FROM entries WHERE kind IN ('pending','auth_code','access','refresh')"
            ).fetchall():
                value = json.loads(raw)
                owner = value.get("client_id") or value.get("model", {}).get("client_id")
                if owner == client_id:
                    db.execute("DELETE FROM entries WHERE kind=? AND key=?", (kind, key))
        for kind, key, raw in db.execute(
            "SELECT kind,key,data FROM entries WHERE kind='pending'"
        ).fetchall():
            if json.loads(raw).get("client_id") == chosen_id:
                db.execute("DELETE FROM entries WHERE kind=? AND key=?", (kind, key))
        db.commit()
        return chosen_data
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:28768")
    parser.add_argument("--state-dir", required=True)
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    state = Path(args.state_dir).resolve()
    pairing_key = (state / "pairing.secret").read_text(encoding="ascii").strip()
    resource = "https://codex-native2-dev.continuos.com.br/mcp"
    redirect_uri = "https://chatgpt.com/connector_platform_oauth_redirect"

    with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as client:
        health = client.get(base + "/health")
        require(health.status_code == 200, "health", health.status_code)
        health_data = health.json()
        require(health_data.get("service") == "ContinuosWebIntegracaoDev", "health identity")
        require(health_data.get("mode") == "isolated-dev" and health_data.get("side_effects") is False, "health isolation")

        metadata = client.get(base + "/.well-known/oauth-authorization-server")
        require(metadata.status_code == 200, "authorization metadata", metadata.status_code)
        metadata_data = metadata.json()
        require(metadata_data.get("registration_endpoint", "").endswith("/register"), "DCR metadata")

        protected = client.get(base + "/.well-known/oauth-protected-resource/mcp")
        require(protected.status_code == 200, "protected resource metadata", protected.status_code)
        require(protected.json().get("resource") == resource, "protected resource identity")

        unauth = client.post(base + "/mcp", json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26", "capabilities": {},
                "clientInfo": {"name": "dev-oauth-smoke", "version": "1.0"},
            },
        })
        require(unauth.status_code == 401, "anonymous MCP rejection", unauth.status_code)
        require("oauth-protected-resource/mcp" in unauth.headers.get("www-authenticate", ""), "401 resource metadata")

        client_data = existing_smoke_client(state)
        if client_data is None:
            registration = client.post(base + "/register", json={
                "client_name": "ContinuosWebIntegracao DEV smoke",
                "redirect_uris": [redirect_uri],
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "token_endpoint_auth_method": "client_secret_post",
                "scope": "codex.control",
            })
            require(registration.status_code in (200, 201), "dynamic client registration", registration.status_code)
            client_data = registration.json()
        client_id = client_data["client_id"]
        client_secret = client_data["client_secret"]

        verifier = secrets.token_urlsafe(48)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        state_value = secrets.token_urlsafe(24)
        authorize = client.get(base + "/authorize", params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "scope": "codex.control",
            "state": state_value,
            "resource": resource,
        })
        require(authorize.status_code in (302, 303), "authorization redirect", authorize.status_code)
        authorize_location = urlparse(authorize.headers.get("location", ""))
        if authorize_location.path == "/pair":
            pair_url = base + authorize_location.path + ("?" + authorize_location.query if authorize_location.query else "")
            pair_request_id = parse_qs(urlparse(pair_url).query).get("request_id", [""])[0]
            require(bool(pair_request_id), "DEV pairing request id")
            pair_page = client.get(pair_url)
            require(pair_page.status_code == 200 and "DEV pairing key" in pair_page.text, "DEV pairing page", pair_page.status_code)
            wrong_key = "this-is-deliberately-not-the-dev-pairing-key"
            rejected = client.post(base + "/pair/submit", data={
                "request_id": pair_request_id,
                "pairing_key": wrong_key,
            })
            require(rejected.status_code == 403 and "Incorrect DEV pairing key" in rejected.text,
                    "incorrect DEV key rejected", rejected.status_code)
            require("name=\"pairing_key\"" in rejected.text and pair_request_id in rejected.text,
                    "pairing retry retains request")
            require(wrong_key not in rejected.text and pairing_key not in rejected.text,
                    "pairing retry does not expose secrets")
            rejected_unicode = client.post(base + "/pair/submit", data={
                "request_id": pair_request_id,
                "pairing_key": "invalid-dev-key-🔒",
            })
            require(rejected_unicode.status_code == 403,
                    "non-ASCII invalid DEV key rejected without server error", rejected_unicode.status_code)
            paired = client.post(base + "/pair/submit", data={
                "request_id": pair_request_id,
                "pairing_key": " \n" + pairing_key + "\r\n",
            })
            require(paired.status_code == 303, "DEV pairing approval after copied whitespace", paired.status_code)
            callback = urlparse(paired.headers.get("location", ""))
            pairing_flow = "performed"
        else:
            callback = authorize_location
            pairing_flow = "existing-trusted-consent"
        callback_query = parse_qs(callback.query)
        code = callback_query.get("code", [""])[0]
        require(bool(code) and callback_query.get("state", [""])[0] == state_value, "PKCE authorization code")

        reuse_verifier = secrets.token_urlsafe(48)
        reuse_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(reuse_verifier.encode()).digest()
        ).rstrip(b"=").decode()
        reuse_state = secrets.token_urlsafe(24)
        reuse_authorize = client.get(base + "/authorize", params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "code_challenge": reuse_challenge,
            "code_challenge_method": "S256",
            "scope": "codex.control",
            "state": reuse_state,
            "resource": resource,
        })
        require(reuse_authorize.status_code in (302, 303),
                "trusted consent reuse redirect", reuse_authorize.status_code)
        reuse_callback = urlparse(reuse_authorize.headers.get("location", ""))
        reuse_query = parse_qs(reuse_callback.query)
        require(reuse_callback.path == urlparse(redirect_uri).path,
                "trusted consent reuses authorization without pairing")
        require(bool(reuse_query.get("code")) and reuse_query.get("state", [""])[0] == reuse_state,
                "trusted consent reuse authorization code")

        def redeem_code() -> httpx.Response:
            with httpx.Client(timeout=10, trust_env=False) as parallel_client:
                return parallel_client.post(base + "/token", data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code_verifier": verifier,
                    "resource": resource,
                })

        with ThreadPoolExecutor(max_workers=4) as pool:
            code_responses = list(pool.map(lambda _: redeem_code(), range(4)))
        require(sum(r.status_code == 200 for r in code_responses) == 1,
                "authorization code consumed exactly once")
        require(all(r.status_code in (200, 400) for r in code_responses),
                "authorization code replay rejected")
        token = next(r for r in code_responses if r.status_code == 200)
        token_data = token.json()
        require(token_data.get("token_type", "").lower() == "bearer", "bearer token type")
        old_access_token = token_data["access_token"]
        def rotate_refresh() -> httpx.Response:
            with httpx.Client(timeout=10, trust_env=False) as parallel_client:
                return parallel_client.post(base + "/token", data={
                    "grant_type": "refresh_token",
                    "refresh_token": token_data["refresh_token"],
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "scope": "codex.control",
                    "resource": resource,
                })

        with ThreadPoolExecutor(max_workers=4) as pool:
            refresh_responses = list(pool.map(lambda _: rotate_refresh(), range(4)))
        require(sum(r.status_code == 200 for r in refresh_responses) == 1,
                "refresh token rotated exactly once")
        require(all(r.status_code in (200, 400) for r in refresh_responses),
                "reused refresh tokens rejected")
        refresh = next(r for r in refresh_responses if r.status_code == 200)
        refreshed = refresh.json()
        require(bool(refreshed.get("access_token")) and bool(refreshed.get("refresh_token")), "rotated token pair")
        old_access = client.post(base + "/mcp", headers={
            "Authorization": "Bearer " + old_access_token,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }, json={"jsonrpc": "2.0", "id": 99, "method": "tools/list"})
        require(old_access.status_code == 401, "old access token revoked after refresh", old_access.status_code)
        access_token = refreshed["access_token"]

        headers = {
            "Authorization": "Bearer " + access_token,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-03-26",
        }

        def rpc(request_id: int, method: str, params: dict | None = None) -> dict:
            response = client.post(base + "/mcp", headers=headers, json={
                "jsonrpc": "2.0", "id": request_id, "method": method,
                **({"params": params} if params is not None else {}),
            })
            require(response.status_code == 200, method, response.status_code)
            if "text/event-stream" in response.headers.get("content-type", ""):
                events = [line[6:] for line in response.text.splitlines() if line.startswith("data: ")]
                require(bool(events), method + " SSE body")
                return json.loads(events[-1])
            return response.json()

        initialized = rpc(2, "initialize", {
            "protocolVersion": "2025-03-26", "capabilities": {},
            "clientInfo": {"name": "dev-oauth-smoke", "version": "1.0"},
        })
        require("result" in initialized, "authenticated MCP initialize")
        listed = rpc(3, "tools/list")
        tools = listed.get("result", {}).get("tools", [])
        tool_names = sorted(tool.get("name", "") for tool in tools)
        require(tool_names == ["dev_echo", "dev_ping", "dev_read_fixture"], "isolated tool catalog")

        ping = rpc(4, "tools/call", {"name": "dev_ping", "arguments": {}})
        ping_result = ping.get("result", {}).get("structuredContent", {})
        require(
            ping_result.get("service") == "ContinuosWebIntegracaoDev"
            and ping_result.get("production_dispatcher_loaded") is False,
            "isolated dev_ping tool",
        )
        echo = rpc(5, "tools/call", {"name": "dev_echo", "arguments": {"message": "oauth-pkce-ok"}})
        require(echo.get("result", {}).get("structuredContent", {}).get("echo") == "oauth-pkce-ok", "dev_echo tool")
        fixture = rpc(6, "tools/call", {"name": "dev_read_fixture", "arguments": {"name": "hello.txt"}})
        fixture_result = fixture.get("result", {}).get("structuredContent", {})
        require(fixture_result.get("name") == "hello.txt" and "no production connection" in fixture_result.get("content", ""), "fixed DEV fixture tool")

        revoked = client.post(base + "/revoke", data={
            "token": refreshed["refresh_token"],
            "token_type_hint": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
        })
        require(revoked.status_code == 200, "refresh-token revocation", revoked.status_code)

    print("DEV_GATEWAY_OAUTH_PKCE_MCP_SMOKE_OK")
    print("service=ContinuosWebIntegracaoDev")
    print("anonymous_mcp=401")
    print("oauth=authorization_code+PKCE_S256+refresh_rotation+revocation")
    print("pairing=" + pairing_flow)
    print("trusted_consent_reuse=passed")
    print("tools=dev_ping,dev_echo,dev_read_fixture")
    print("production_dispatcher=not_loaded")
    print("secrets=not_logged")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
