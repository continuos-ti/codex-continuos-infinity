# Integrações nativas e Cloudflare

## Identidade e descoberta

O nome desejado do conector MCP é ContinuosWebIntegracao. A seleção @ContinuosWebIntegracao deve ser confirmada no composer. O modo Zero Risk é isolado e possui sua identidade. O bridge conserva vínculo da tarefa, identificação das ferramentas e permissões emitidas pelo Codex.

Endpoints públicos de referência do ambiente anterior:

- MCP externo: https://codex-native2.continuos.com.br/mcp
- Health externo: https://codex-native2.continuos.com.br/health
- Windows Local: https://windows-local.continuos.com.br/health
- Responses local: 127.0.0.1:17841
- OAuth/gateway local: 127.0.0.1:28765

Os endpoints de referência podem mudar. As credenciais, audiência, tokens, PKCE e escopos são geridos pela camada autorizada, fora do repositório. Nenhuma chave privada deve ser incluída em exemplos.

## Transporte MCP configurável

O perfil `full` no modo Automatic permite selecionar explicitamente `mcpTransport=external-cloudflare` e informar `externalGateway.mcpUrl`, `externalGateway.healthUrl` e `externalGateway.expectedService`. O setup aceita `--mcp-transport external-cloudflare` e, opcionalmente, `--external-mcp-url`, `--external-health-url` e `--external-service`. O setup DEV isolado aceita os mesmos parâmetros após `dev setup --full`. A interface do launcher também permite escolher o transporte e ajustar os três campos.

Os endpoints devem ser URLs HTTPS canônicas, sem credenciais, query ou fragmento. A sondagem de saúde verifica a resposta HTTP e os campos `status=ok` e `service=expectedService`. Essa verificação confirma somente a disponibilidade e a identidade declarada do endpoint de health. O acesso MCP efetivo depende de OAuth/PKCE e de um vínculo nativo autorizado pelo Codex e requer homologação autenticada separada.

Em 12/11/2026, consultas HTTPS somente leitura ao ambiente externo confirmaram `HTTP 200` com `{"status":"ok","service":"ContinuosWebIntegracao"}` em `/health`, `HTTP 200` com `{"status":"ok"}` no health do Windows Local e `HTTP 401` em `/mcp` sem credenciais. `/.well-known/oauth-authorization-server` respondeu `HTTP 200` e anunciou `authorization_code`, `refresh_token`, escopo `codex.control` e PKCE `S256`. O endpoint `/.well-known/oauth-protected-resource` respondeu `HTTP 404`. Esses resultados verificam apenas as rotas e os metadados públicos observados naquele momento; ainda é necessário validar uma autorização OAuth/PKCE completa e chamadas MCP com identidade de turno nativa no staging do fork.

No transporte externo, o supervisor observa o gateway e aguarda prontidão durante a inicialização. Ele registra o recurso como externo, sem assumir posse do túnel. O modo Zero Risk conserva o transporte `openai-tunnel` e pode reter a preferência Cloudflare para uma troca posterior. Perfis antigos sem `mcpTransport` continuam usando `openai-tunnel` até configuração explícita. O modo `browser-only` rejeita configuração MCP.

## Infraestrutura e ferramentas

A ordem desejada de supervisão é Windows Local → Cloudflare/gateway → Codex → Infinity. A saúde de um processo externo não confere ao Infinity autoridade para encerrá-lo. O supervisor deve distinguir recursos próprios, serviços compartilhados e processos com tarefas em execução.

Windows Local e Agent Desktop são extensões opcionais quando conectados e autorizados. As contagens de ferramentas variam por versão. A configuração deve aceitar outras integrações MCP, como n8n, Blender, OrcaSlicer e VPS, sem incluir dados de suas contas no código-fonte.

Os testes incluem launcher/tests/cloudflare-connector.test.cjs, tests/continuos-connector.test.ts, tests/long-native-tool-polling*.test.ts e launcher/tests/runtime-supervisor.test.cjs. A validação autenticada do gateway real ainda requer staging.
