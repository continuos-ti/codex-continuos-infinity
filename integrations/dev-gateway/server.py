"""Isolated OAuth/PKCE MCP endpoint for Codex Continuos Infinity DEV.

This service intentionally exposes only inert, read-only fixture tools. It must
never import the production Codex/Windows Local gateway or its dispatcher.
"""

from __future__ import annotations

import hashlib
import hmac
import html
import json
import os
from pathlib import Path
import secrets
import sqlite3
import sys
import threading
import time
from urllib.parse import parse_qs, parse_qsl, urlencode, urlsplit, urlunsplit

from mcp.server.auth.provider import (
    OAuthAuthorizationServerProvider,
    AuthorizationCode,
    AuthorizationParams,
    AccessToken,
    RefreshToken,
    RegistrationError,
    TokenError,
    AuthorizeError,
)
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from mcp.types import CallToolResult, TextContent, Tool
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse
import uvicorn


SERVICE_NAME = "ContinuosWebIntegracaoDev"
SCOPE = "codex.control"
STATE = Path(os.environ.get(
    "CODEX_INFINITY_DEV_GATEWAY_STATE",
    str(Path(os.environ.get("LOCALAPPDATA", Path.home())) / "CodexInfinityDevGateway"),
)).resolve()
CONFIG = json.loads((STATE / "config.json").read_text(encoding="utf-8"))
BASE = CONFIG["public_url"].rstrip("/")
RESOURCE = BASE + "/mcp"
PAIR_KEY = (STATE / "pairing.secret").read_text(encoding="ascii").strip()

if not PAIR_KEY or len(PAIR_KEY) < 32:
    raise RuntimeError("DEV gateway pairing secret must contain at least 32 characters")
if not isinstance(CONFIG.get("port"), int) or not 1 <= CONFIG["port"] <= 65535:
    raise RuntimeError("DEV gateway port is invalid")
if "codex-native2.continuos.com.br" in BASE.lower():
    raise RuntimeError("DEV gateway cannot use the production hostname")


def audit(event: str, request_id: str = "") -> None:
    """Persist event labels and truncated request digests, never OAuth material."""
    digest = hashlib.sha256(request_id.encode("utf-8")).hexdigest()[:12] if request_id else "-"
    try:
        with (STATE / "oauth-events.log").open("a", encoding="utf-8") as log:
            log.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} event={event} request={digest}\n")
    except OSError:
        pass


class Provider(OAuthAuthorizationServerProvider):
    def __init__(self) -> None:
        self.db = sqlite3.connect(STATE / "oauth.sqlite", check_same_thread=False, timeout=10)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=10000")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS entries(kind TEXT, key TEXT, data TEXT, PRIMARY KEY(kind,key))"
        )
        self.db.commit()
        self.lock = threading.RLock()

    def put(self, kind: str, key: str, value: dict) -> None:
        with self.lock:
            self.db.execute(
                "INSERT OR REPLACE INTO entries VALUES(?,?,?)",
                (kind, key, json.dumps(value, separators=(",", ":"))),
            )
            self.db.commit()

    def get(self, kind: str, key: str) -> dict | None:
        with self.lock:
            row = self.db.execute(
                "SELECT data FROM entries WHERE kind=? AND key=?", (kind, key)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def delete(self, kind: str, key: str) -> None:
        with self.lock:
            self.db.execute("DELETE FROM entries WHERE kind=? AND key=?", (kind, key))
            self.db.commit()

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        data = self.get("client", client_id)
        return OAuthClientInformationFull.model_validate(data) if data else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        redirects = [str(uri) for uri in client_info.redirect_uris or []]
        allowed = all(
            uri.startswith("https://chatgpt.com/connector/")
            or uri == "https://chatgpt.com/connector_platform_oauth_redirect"
            for uri in redirects
        )
        if not redirects or not allowed or client_info.token_endpoint_auth_method not in (
            "client_secret_post", "client_secret_basic"
        ):
            raise RegistrationError("invalid_client_metadata", "Only confidential ChatGPT connector clients are accepted.")
        with self.lock:
            count = self.db.execute("SELECT COUNT(*) FROM entries WHERE kind='client'").fetchone()[0]
        if count >= 8:
            raise RegistrationError("invalid_client_metadata", "DEV client registration limit reached.")
        self.put("client", client_info.client_id, client_info.model_dump(mode="json"))
        audit("client_registered", client_info.client_id)

    def create_code_redirect(self, client_id: str, params: AuthorizationParams) -> str:
        code = AuthorizationCode(
            code=secrets.token_urlsafe(48),
            scopes=params.scopes,
            expires_at=int(time.time()) + 300,
            client_id=client_id,
            code_challenge=params.code_challenge,
            redirect_uri=params.redirect_uri,
            redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            resource=RESOURCE,
            subject="dev-test-client",
        )
        self.put("auth_code", hashlib.sha256(code.code.encode()).hexdigest(), code.model_dump(mode="json"))
        old = urlsplit(str(params.redirect_uri))
        query = {"code": code.code}
        if params.state is not None:
            query["state"] = params.state
        combined = urlencode([*parse_qsl(old.query), *query.items()])
        return urlunsplit((old.scheme, old.netloc, old.path, combined, old.fragment))

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        registered = await self.get_client(client.client_id)
        if not registered or not client.client_secret or client.token_endpoint_auth_method not in (
            "client_secret_post", "client_secret_basic"
        ):
            raise AuthorizeError("unauthorized_client", "Unregistered DEV client.")
        if params.resource != RESOURCE or list(params.scopes or []) != [SCOPE]:
            raise AuthorizeError("invalid_request", "Invalid DEV resource or scope.")
        consent = self.get("trusted_consent", client.client_id)
        registered_redirects = [str(uri) for uri in registered.redirect_uris or []]
        if (
            consent
            and consent.get("expires_at", 0) > time.time()
            and consent.get("redirect_uri") == str(params.redirect_uri)
            and str(params.redirect_uri) in registered_redirects
            and consent.get("scope") == SCOPE
            and consent.get("resource") == RESOURCE
        ):
            audit("trusted_dev_client_auto_authorized", client.client_id)
            return self.create_code_redirect(client.client_id, params)
        now = time.time()
        with self.lock:
            pending = self.db.execute("SELECT key,data FROM entries WHERE kind='pending'").fetchall()
        live = []
        for key, raw in pending:
            entry = json.loads(raw)
            if entry["expires_at"] <= now:
                self.delete("pending", key)
            else:
                live.append(key)
        if len(live) >= 40:
            raise AuthorizeError("temporarily_unavailable", "DEV pending authorization limit reached.")
        nonce = secrets.token_urlsafe(32)
        self.put("pending", hashlib.sha256(nonce.encode()).hexdigest(), {
            "client_id": client.client_id,
            "params": params.model_dump(mode="json"),
            "expires_at": now + 1200,
            "attempts": 0,
        })
        audit("dev_authorization_created", nonce)
        return BASE + "/pair?request_id=" + nonce

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        data = self.get("auth_code", hashlib.sha256(authorization_code.encode()).hexdigest())
        code = AuthorizationCode.model_validate(data) if data else None
        return code if code and code.expires_at >= time.time() and code.client_id == client.client_id else None

    def issue(self, client_id: str, scopes: list[str]) -> OAuthToken:
        """Insert a token pair inside the caller's SQLite transaction."""
        access = secrets.token_urlsafe(48)
        refresh = secrets.token_urlsafe(48)
        family = secrets.token_hex(16)
        access_model = AccessToken(
            token="", client_id=client_id, scopes=scopes,
            expires_at=int(time.time()) + 3600, resource=RESOURCE, subject="dev-test-client",
        )
        refresh_model = RefreshToken(
            token="", client_id=client_id, scopes=scopes,
            expires_at=int(time.time()) + 2592000, subject="dev-test-client",
        )
        self.db.executemany(
            "INSERT INTO entries(kind,key,data) VALUES(?,?,?)",
            [
                ("access", hashlib.sha256(access.encode()).hexdigest(), json.dumps({
                    "model": access_model.model_dump(), "family": family,
                })),
                ("refresh", hashlib.sha256(refresh.encode()).hexdigest(), json.dumps({
                    "model": refresh_model.model_dump(), "family": family,
                })),
            ],
        )
        return OAuthToken(
            access_token=access, token_type="Bearer", expires_in=3600,
            refresh_token=refresh, scope=" ".join(scopes),
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        key = hashlib.sha256(authorization_code.code.encode()).hexdigest()
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                data = self.get("auth_code", key)
                if not data:
                    raise TokenError("invalid_grant", "Authorization code is missing or already used.")
                code = AuthorizationCode.model_validate(data)
                if code.expires_at < time.time() or code.client_id != client.client_id:
                    raise TokenError("invalid_grant", "Authorization code is invalid or expired.")
                self.db.execute("DELETE FROM entries WHERE kind='auth_code' AND key=?", (key,))
                result = self.issue(client.client_id, code.scopes)
                self.db.commit()
            except BaseException:
                self.db.rollback()
                raise
        audit("dev_authorization_code_exchanged", authorization_code.code)
        return result

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        data = self.get("refresh", hashlib.sha256(refresh_token.encode()).hexdigest())
        if (
            not data
            or data["model"]["client_id"] != client.client_id
            or data["model"]["expires_at"] < time.time()
        ):
            return None
        return RefreshToken(**{**data["model"], "token": refresh_token})

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        key = hashlib.sha256(refresh_token.token.encode()).hexdigest()
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                data = self.get("refresh", key)
                if (
                    not data
                    or data["model"]["client_id"] != client.client_id
                    or data["model"]["expires_at"] < time.time()
                    or not set(scopes).issubset(data["model"]["scopes"])
                ):
                    raise TokenError("invalid_grant", "Refresh token is expired, revoked, or already used.")
                family = data["family"]
                rows = self.db.execute(
                    "SELECT kind,key,data FROM entries WHERE kind IN ('access','refresh')"
                ).fetchall()
                for kind, entry_key, raw in rows:
                    if json.loads(raw)["family"] == family:
                        self.db.execute("DELETE FROM entries WHERE kind=? AND key=?", (kind, entry_key))
                result = self.issue(client.client_id, scopes)
                self.db.commit()
            except BaseException:
                self.db.rollback()
                raise
        return result

    async def load_access_token(self, token: str) -> AccessToken | None:
        data = self.get("access", hashlib.sha256(token.encode()).hexdigest())
        if (
            not data
            or not self.get("client", data["model"]["client_id"])
            or data["model"]["expires_at"] < time.time()
            or data["model"]["resource"] != RESOURCE
        ):
            return None
        return AccessToken(**{**data["model"], "token": token})

    async def revoke_token(self, token: OAuthToken | AccessToken | RefreshToken) -> None:
        token_value = token.token
        key = hashlib.sha256(token_value.encode()).hexdigest()
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                data = self.get("access", key) or self.get("refresh", key)
                if data:
                    family = data["family"]
                    rows = self.db.execute(
                        "SELECT kind,key,data FROM entries WHERE kind IN ('access','refresh')"
                    ).fetchall()
                    for kind, entry_key, raw in rows:
                        if json.loads(raw)["family"] == family:
                            self.db.execute("DELETE FROM entries WHERE kind=? AND key=?", (kind, entry_key))
                self.db.commit()
            except BaseException:
                self.db.rollback()
                raise


provider = Provider()
mcp = FastMCP(
    "ContinuosWebIntegracao DEV",
    instructions=(
        "Isolated development-only MCP gateway. Only inert DEV fixture tools are available; "
        "no production Codex, Windows Local, desktop, shell, or external service is connected."
    ),
    auth_server_provider=provider,
    auth=AuthSettings(
        issuer_url=BASE,
        resource_server_url=RESOURCE,
        required_scopes=[SCOPE],
        client_registration_options=ClientRegistrationOptions(
            enabled=True, valid_scopes=[SCOPE], default_scopes=[SCOPE]
        ),
        revocation_options=RevocationOptions(enabled=True),
    ),
    host="127.0.0.1",
    port=CONFIG["port"],
    stateless_http=True,
    json_response=True,
    log_level="WARNING",
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[BASE.split("://", 1)[1], "127.0.0.1:*"] ,
        allowed_origins=[BASE],
    ),
)

TOOL_SCHEMAS = [
    {
        "name": "dev_ping",
        "description": "Read-only health probe for the isolated DEV MCP provider.",
        "inputSchema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    },
    {
        "name": "dev_echo",
        "description": "Echo a short string through the authenticated DEV MCP transport; no side effect occurs.",
        "inputSchema": {
            "type": "object",
            "properties": {"message": {"type": "string", "maxLength": 512}},
            "required": ["message"],
            "additionalProperties": False,
        },
    },
    {
        "name": "dev_read_fixture",
        "description": "Read the single fixed DEV fixture file; arbitrary paths are not accepted.",
        "inputSchema": {
            "type": "object",
            "properties": {"name": {"type": "string", "enum": ["hello.txt"]}},
            "required": ["name"],
            "additionalProperties": False,
        },
    },
]


def tool_result(value: dict) -> CallToolResult:
    return CallToolResult.model_validate({
        "content": [TextContent(type="text", text=json.dumps(value, ensure_ascii=False))],
        "structuredContent": value,
    })


@mcp._mcp_server.list_tools()
async def list_tools() -> list[Tool]:
    return [Tool.model_validate({
        **schema,
        "_meta": {"securitySchemes": [{"type": "oauth2", "scopes": [SCOPE]}]},
    }) for schema in TOOL_SCHEMAS]


@mcp._mcp_server.call_tool()
async def call_tool(name: str, arguments: dict | None) -> CallToolResult:
    args = arguments or {}
    if name == "dev_ping" and not args:
        return tool_result({
            "status": "ok", "service": SERVICE_NAME, "mode": "isolated-dev",
            "side_effects": False,
            "production_dispatcher_loaded": any(
                module in sys.modules for module in ("codex_cf_oauth", "codex_cf_gateway_lab")
            ),
        })
    if name == "dev_echo" and set(args) == {"message"}:
        message = args["message"]
        if not isinstance(message, str) or len(message) > 512:
            return CallToolResult(isError=True, content=[TextContent(type="text", text="Invalid DEV echo input")])
        return tool_result({"echo": message, "service": SERVICE_NAME, "side_effects": False})
    if name == "dev_read_fixture" and set(args) == {"name"} and args["name"] == "hello.txt":
        fixture = STATE / "fixtures" / "hello.txt"
        if not fixture.is_file():
            return CallToolResult(isError=True, content=[TextContent(type="text", text="DEV fixture unavailable")])
        content = fixture.read_text(encoding="utf-8")
        return tool_result({
            "name": "hello.txt", "content": content,
            "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
            "side_effects": False,
        })
    return CallToolResult(isError=True, content=[TextContent(type="text", text="Unknown or invalid DEV tool call")])


HEADERS = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'",
}


def pairing_form(nonce: str, error: str = "") -> HTMLResponse:
    """Keep a rejected DEV pairing attempt on the same authorization request."""
    page = (
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>ContinuosWebIntegracao DEV</title>"
        "<style>body{max-width:480px;margin:50px auto;font-family:system-ui;line-height:1.5}input,button{padding:12px;width:100%;box-sizing:border-box;margin-top:12px}</style>"
        "<h2>Authorize isolated DEV connector</h2>"
        "<p>Enter the pairing key generated locally for the DEV gateway. This key is not the production key.</p>"
        + ("<p role=\"alert\">" + html.escape(error) + "</p>" if error else "")
        + "<form method=\"POST\" action=\"/pair/submit\"><input type=\"hidden\" name=\"request_id\" value=\""
        + html.escape(nonce, quote=True)
        + "\"><input type=\"password\" name=\"pairing_key\" required autocomplete=\"off\" placeholder=\"DEV pairing key\">"
        "<button type=\"submit\">Authorize DEV connector</button></form></html>"
    )
    return HTMLResponse(page, status_code=403 if error else 200, headers=HEADERS)


@mcp.custom_route("/pair", methods=["GET"])
async def pair(request):
    nonce = request.query_params.get("request_id", "")
    entry = provider.get("pending", hashlib.sha256(nonce.encode()).hexdigest())
    if not entry or entry["expires_at"] < time.time():
        return HTMLResponse("DEV authorization request expired. Start a new connector authorization.", status_code=400, headers=HEADERS)
    if entry["attempts"] >= 5:
        return HTMLResponse("Too many attempts. Start a new DEV authorization.", status_code=429, headers=HEADERS)
    return pairing_form(nonce)


@mcp.custom_route("/pair/submit", methods=["POST"])
async def pair_submit(request):
    body = await request.body()
    if len(body) > 2048:
        return HTMLResponse("Invalid form.", status_code=400, headers=HEADERS)
    data = parse_qs(body.decode("utf-8", "replace"), keep_blank_values=True)
    nonce = data.get("request_id", [""])[0]
    candidate = data.get("pairing_key", [""])[0]
    nonce_hash = hashlib.sha256(nonce.encode()).hexdigest()
    with provider.lock:
        entry = provider.get("pending", nonce_hash)
        if not entry or entry["expires_at"] < time.time():
            audit("dev_pair_expired", nonce)
            return HTMLResponse("DEV authorization request expired.", status_code=400, headers=HEADERS)
        if entry["attempts"] >= 5:
            return HTMLResponse("Too many attempts. Start a new DEV authorization.", status_code=429, headers=HEADERS)
        entry["attempts"] += 1
        provider.put("pending", nonce_hash, entry)
    if not hmac.compare_digest(candidate.strip().encode("utf-8"), PAIR_KEY.encode("ascii")):
        audit("dev_pair_incorrect", nonce)
        if entry["attempts"] >= 5:
            return HTMLResponse("Too many attempts. Start a new DEV authorization.", status_code=429, headers=HEADERS)
        return pairing_form(nonce, "Incorrect DEV pairing key. Check the DEV key and try again.")
    if entry.get("completed_redirect"):
        if entry.get("completed_code_expires_at", 0) <= time.time():
            return HTMLResponse("DEV authorization code expired. Start a new authorization.", status_code=409, headers=HEADERS)
        audit("dev_pair_resubmitted", nonce)
        return RedirectResponse(entry["completed_redirect"], status_code=303, headers=HEADERS)
    params = AuthorizationParams.model_validate(entry["params"])
    now = time.time()
    code = AuthorizationCode(
        code=secrets.token_urlsafe(48), scopes=params.scopes, expires_at=now + 300,
        client_id=entry["client_id"], code_challenge=params.code_challenge,
        redirect_uri=params.redirect_uri,
        redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
        resource=RESOURCE, subject="dev-test-client",
    )
    provider.put("auth_code", hashlib.sha256(code.code.encode()).hexdigest(), code.model_dump(mode="json"))
    old = urlsplit(str(params.redirect_uri))
    query = {"code": code.code}
    if params.state is not None:
        query["state"] = params.state
    combined = urlencode([*parse_qsl(old.query), *query.items()])
    target = urlunsplit((old.scheme, old.netloc, old.path, combined, old.fragment))
    entry["completed_redirect"] = target
    entry["completed_code_expires_at"] = code.expires_at
    provider.put("pending", nonce_hash, entry)
    provider.put("trusted_consent", entry["client_id"], {
        "redirect_uri": str(params.redirect_uri),
        "scope": SCOPE,
        "resource": RESOURCE,
        "expires_at": time.time() + 30 * 86400,
    })
    audit("dev_pair_approved", nonce)
    return RedirectResponse(target, status_code=303, headers=HEADERS)


@mcp.custom_route("/health", methods=["GET"])
async def health(request):
    return JSONResponse({
        "status": "ok", "service": SERVICE_NAME, "mode": "isolated-dev",
        "side_effects": False,
    }, headers={"Cache-Control": "no-store"})


app = mcp.streamable_http_app()


if __name__ == "__main__":
    uvicorn.run(
        app, host="127.0.0.1", port=CONFIG["port"],
        access_log=False, proxy_headers=False, log_level="warning",
    )
