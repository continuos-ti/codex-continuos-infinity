# Codex Continuos Infinity — arquitetura

Fork do projeto miuuyy/codex-chatgpt-web na base v6.1.18 com personalizações Windows da distribuição 6.1.13. O fork preserva relação parent com upstream e executa atualizações somente após merge, testes e pacote próprios.

## Componentes

| Área | Código | Contrato |
| --- | --- | --- |
| Navegador e modelos | src/adapters/chatgpt-web/browser-worker.ts, model-selection.ts | Streaming, DOM, seleção de modelo e effort verificados antes do envio |
| Supervisor por eventos | in-band-auto-repair.ts, browser-worker.ts, index.ts | Uma tentativa de diagnóstico após turno aceito com falta de resposta final |
| CWD e sandbox | environment.ts, thread-environment.ts, codex-rollout-environment.ts | Apenas rollout nativo correspondente a thread, turn, roots e sandbox |
| MCP e tarefas longas | mcp-server.ts, turn-broker.ts, turn-progress.ts, broker-operation-identity.ts, integrations/windows-local/ | Identidade de ferramenta, ID de operação durável opt-in e polling da mesma operação |
| Anexos | attachment-upload.ts, attachment-upload-lease.ts | Lease interprocesso de upload |
| Launcher | launcher/electron/main.cjs, runtime-supervisor.cjs, launcher/src | Interface, browser autenticado, supervisor e estado de processo |
| Produto | launcher/electron/brand.cjs, profile.cjs, update.cjs | Branding, appId, NSIS GUID, perfil e canal próprios |
| CI/release | .github/workflows/ci.yml, release.yml | Testes, build, smoke, hashes e releases apenas no fork |

O runtime mantém CODEX_CHATGPT_WEB_HOME como variável interna de compatibilidade, mas o launcher preenche o diretório independente HOME/.codex-continuos-infinity. A pasta de dados Electron é APPDATA/Codex Continuos Infinity. A autenticação do navegador é do usuário e nunca deve ser transferida para o repositório.

O runtime distingue execução de tarefas, transporte MCP e saúde do sistema. A supervisão de serviço Windows, gateway OAuth, ChatGPT e Cloudflare não deve interromper turnos ativos para sanar sintomas transitórios.

Provedores MCP podem declarar `x-codex-operation-id` e `x-codex-provider-epoch` no JSON Schema da ferramenta. O adaptador injeta o `callId` do broker e a época publicada pelo provedor. A integração Windows Local persiste metadados do `screenshot_id` ativo e a identidade de `windows_command`, permitindo revalidar a captura e consultar o processo após reinício do servidor. O ledger confirma o estado do processo acompanhado. Ele não comprova, sozinho, efeitos de processos destacados ou serviços externos.

Mais detalhes em SUPERVISOR.md, TRUSTED_CWD.md e INTEGRATIONS.md.
