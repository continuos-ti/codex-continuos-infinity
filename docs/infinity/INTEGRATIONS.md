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

## Infraestrutura e ferramentas

A ordem desejada de supervisão é Windows Local → Cloudflare/gateway → Codex → Infinity. A saúde de um processo externo não confere ao Infinity autoridade para encerrá-lo. O supervisor deve distinguir recursos próprios, serviços compartilhados e processos com tarefas em execução.

Windows Local e Agent Desktop são extensões opcionais quando conectados e autorizados. As contagens de ferramentas variam por versão. A configuração deve aceitar outras integrações MCP, como n8n, Blender, OrcaSlicer e VPS, sem incluir dados de suas contas no código-fonte.

Os testes incluem launcher/tests/cloudflare-connector.test.cjs, tests/continuos-connector.test.ts, tests/long-native-tool-polling*.test.ts e launcher/tests/runtime-supervisor.test.cjs. A validação autenticada do gateway real ainda requer staging.
