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

## Identidade durável de operações Windows Local

O adaptador reconhece duas extensões opcionais no JSON Schema MCP. `x-codex-operation-id=true` solicita a injeção do `callId` do broker na propriedade `operation_id`. `x-codex-provider-epoch` publica a época do ledger do provedor e solicita sua injeção na propriedade `provider_epoch`. A identidade do broker substitui qualquer `operation_id` fornecido pelo modelo.

A integração em `integrations/windows-local/` adiciona esse contrato a `windows_command`. O ledger SQLite fica em `%LOCALAPPDATA%\WindowsLocalRemote` ou no caminho definido por `WINDOWS_LOCAL_REMOTE_STATE`. Ele conserva o identificador, o hash SHA-256 do comando e do CWD, o PID, o horário de criação do processo e os marcadores duráveis de início e conclusão. O texto bruto do comando e o CWD não entram no ledger. As saídas continuam nos arquivos temporários usados pelo Windows Local.

O mesmo ledger conserva os metadados do `screenshot_id` ativo, incluindo horário de captura, origem e escala dos monitores, dimensões e janela em primeiro plano. Os pixels da captura não são persistidos. Após reinício do servidor, a captura pode ser revalidada dentro da janela original de 60 segundos e com a mesma janela em primeiro plano. Uma nova captura, mudança de foco ou ação de entrada invalida o ID anterior.

`windows_command_result` pode consultar o processo após reinício do servidor. `running` exige correspondência do PID e do horário de criação. `completed` exige código de saída registrado. `unknown`, `provider_changed`, `epoch_required` e `not_found` não autorizam repetição. A ausência de registro é explicitamente não conclusiva. O retorno disponibiliza até 64 KB finais de cada saída quando os arquivos temporários ainda existem.

O contrato acompanha o processo PowerShell iniciado pelo Windows Local. Processos destacados e efeitos de serviços externos exigem consulta específica ao recurso afetado. A reconciliação do ledger não altera `externalEffectsReconciled=false` no broker e não libera retomada automática.

O script `integrations/windows-local/apply-durable-command-jobs.ps1` executa dry-run por padrão, compila uma cópia temporária e preserva o serviço em execução. `-Apply` cria backup com timestamp e altera somente os arquivos-fonte do Windows Local. `-Rollback` restaura o backup mais recente. O script não reinicia o serviço.

Em 12/11/2026, o dry-run foi aprovado contra `H:\Projetos\windows-local` e os caminhos `-Apply` e `-Rollback` passaram em uma cópia descartável do provedor. A fonte real em `H:\Projetos\windows-local` permaneceu inalterada para preservar chamadas ativas. A integração só passa a valer após instalação controlada e reinício do provedor. A homologação OAuth/PKCE e a reconciliação de efeitos externos de outros provedores MCP continuam pendentes.

## Auditoria do broker instalado em 12/11/2026

A inspeção somente leitura da instalação atual confirmou que o gateway usa leases de atividade para proteger operações em andamento. `codex_cf_gateway_lab.py` cria um `activity_id` e chama `claim` antes da ação e `activity_complete` ao final. `codex_broker_lease.mjs` transporta essas duas operações ao socket do broker. Esse mecanismo sinaliza atividade para drenagem e não fornece uma chave idempotente por chamada, armazenamento durável do resultado ou consulta de efeitos após crash.

A fonte ativa de Windows Local ainda usa os dicionários de processo `SHOTS` e `JOBS`. O `windows_command_result` depende de um `Popen` mantido em memória, e o servidor stdio não declara `operation_id` nem `provider_epoch`. O endpoint OAuth encaminha a chamada MCP ao servidor local com JSON-RPC `id=1`, que não constitui identidade durável da operação. O bridge Agent Desktop não recebe ID de operação e, em timeout, retorna `delivery=unknown` com `retry=unsafe`.

O ledger SQLite de `integrations/windows-local/` adiciona idempotência e consulta após reinício somente para o wrapper `windows_command`, além de persistir metadados da captura. O pacote continua staged e a fonte ativa permanece intacta. A implantação exige drenagem dos turnos e validação após reinício do provedor. Ações de UI e ferramentas de outros conectores continuam exigindo contratos específicos de identidade, retenção e reconciliação.

## Verificação externa de descoberta OAuth em 12/11/2026

Consultas somente leitura ao gateway público retornaram HTTP 200 em `/health` e no health do Windows Local público. Uma chamada GET sem credencial em `/mcp` retornou HTTP 401 com desafio `WWW-Authenticate: Bearer` e o endereço de `resource_metadata` em `/.well-known/oauth-protected-resource/mcp`. Esse documento respondeu HTTP 200, anunciou o recurso `https://codex-native2.continuos.com.br/mcp`, o servidor de autorização `https://codex-native2.continuos.com.br/` e o escopo `codex.control`. O documento de autorização em `/.well-known/oauth-authorization-server` também respondeu HTTP 200 e anunciou `response_types_supported=[code]` e PKCE `code_challenge_methods_supported=[S256]`.

Em turno nativo vinculado ao conector `ContinuosWebIntegracao`, a ferramenta de leitura `windows_list` retornou as janelas do Windows, confirmando passagem autorizada da chamada pelo bridge atual. Essas evidências validam descoberta HTTP pública e uma ferramenta somente leitura do conector ativo. O fluxo OAuth/PKCE autenticado iniciado pelo **fork em DEV Full**, as chamadas mutáveis reconciliáveis e a retomada após crash ainda precisam de homologação independente.
