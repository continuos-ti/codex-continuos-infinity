# Isolated DEV OAuth/MCP gateway

This service is a separate, public HTTPS endpoint for the `ContinuosWebIntegracao DEV` connector. It has its own OAuth SQLite database and pairing key, and it exposes only three inert tools: `dev_ping`, `dev_echo`, and `dev_read_fixture`. It does not import `codex_cf_oauth.py`, `codex_cf_gateway_lab.py`, Windows Local, Agent Desktop, Blender, or the production Codex broker.

## State and startup

Create a new, empty state directory outside the repository. Never copy production `oauth.sqlite`, `pairing.secret`, configuration, or credentials.

```powershell
$repo = (Resolve-Path '.').Path
$state = Join-Path $env:USERPROFILE '.codex-continuos-infinity-dev-full\gateway'
$python = 'python'
& $python (Join-Path $repo 'integrations\dev-gateway\init_state.py') `
  --state-dir $state --public-url 'https://codex-native2-dev.continuos.com.br' --port 28768
```

Restrict the state directory ACL to the current Windows user, SYSTEM, and Administrators. Then start the service with `CODEX_INFINITY_DEV_GATEWAY_STATE` pointing to that directory. The `pairing.secret` is DEV-only and must never be copied into the production state directory.

When ChatGPT opens the DEV consent page, the local operator must read the DEV `pairing.secret` file privately and enter its value in the browser. Do not paste or transmit the key into a chat, ticket, log, repository, or screenshot. The consent request is valid for 20 minutes with a five-attempt limit. If it expires or reaches that limit, begin a new authorization from the connector's **Connect** action. The server accepts incidental surrounding whitespace from manual copying and preserves the pending request after a rejected attempt.

## Cloudflare

Use a new remotely managed tunnel named `codex-continuos-infinity-dev` and a new DNS hostname `codex-native2-dev.continuos.com.br` routed only to `http://127.0.0.1:28768`. Do not add this hostname to `windows-local-mcp`, do not modify `codex-native2.continuos.com.br`, and do not restart the production tunnel. Store the new tunnel token in a private file and run `cloudflared tunnel run --token-file <private-token-file>` as a separate DEV process.

## Verification

Before connecting ChatGPT, verify `/health` reports `service=ContinuosWebIntegracaoDev`, `/mcp` rejects anonymous requests, OAuth metadata is available, and an authorized MCP client sees only the three `dev_*` tools. Complete the ChatGPT connector OAuth/PKCE and DEV pairing flow only after the dedicated tunnel is healthy. A successful DEV smoke proves OAuth/MCP transport and isolated dispatch; it does not prove production Windows Local tool behavior.

Run the hermetic local CI smoke with `python integrations/dev-gateway/run_smoke.py` after installing `requirements.txt`. It creates a temporary state directory and ephemeral loopback port, then verifies DCR, pairing, PKCE, token refresh/revocation, anonymous rejection, the exact tool catalog, and all three read-only tool calls. No Cloudflare tunnel or production credentials are required by CI.
