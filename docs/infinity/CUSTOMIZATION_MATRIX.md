# Matriz de personalizações — v6.1.13 para Infinity 6.1.18

A comparação normalizada por LF identificou 38 diferenças de conteúdo na tag original 6.1.13. O porte isolou 36 modificações e 12 novos arquivos. Mantivemos o MIT e as versões de dependências do upstream 6.1.18, com nomes próprios de workspace nos lockfiles. Onze conflitos exigiram resolução manual.

| Motivo/alteração local | Código portado e validação | Equivalência upstream |
| --- | --- | --- |
| Falha após turno aceito sem resposta final | in-band-auto-repair.ts, browser-worker.ts, index.ts, testes in-band-autorepair* | O upstream já tinha observação e fencing DOM, complementado com recuperação por evento |
| Identidade Continuos e seleção direta de conector | connector-identity.cjs, mcp-server.ts, config.ts, teste continuos-connector | Seletor genérico upstream, configuração própria Continuos |
| Polling acima de 90 segundos e operação pendente | mcp-server.ts, turn-progress.ts, testes long-native-tool-polling* | Scheduler upstream com limites próprios, harmonizado no merge |
| Lock de upload em concorrência entre processos | attachment-upload-lease.ts, attachment-upload.ts, testes attachment-upload* | Fluxo multipart upstream, lease próprio |
| Falhas de streaming, DOM, UI e confirmação | browser-worker.ts, browser-helper-main.ts, testes browser-worker-contract | Múltiplas correções já resolvidas no upstream preservadas |
| CWD ausente ou incorreto | environment.ts, thread-environment.ts, testes environment e trusted-codex-homes | Verificação de rollout nativo upstream melhorada e preservada |
| Modelo GPT-6 Sol e Astra, esforço localizado | model-selection.ts, chatgpt-session.ts, testes chatgpt-model-selection | Picker estrutural upstream mantido com compatibilidade Continuos |
| Cloudflare e túnel externo gerenciado | connector-identity.cjs, runtime-supervisor.cjs, testes cloudflare-connector | Controlador e túnel base upstream parcialmente equivalentes |
| Inicialização e supervisão sem reiniciar tarefa | launcher/electron/runtime-supervisor.cjs, main.cjs, testes runtime-supervisor | Supervisão oficial ampliada pelo fork |
| Compaction e mensagens do turno | responses/native-context.ts, parser.ts, testes responses-agent-message e server-compaction | Resoluções oficiais 6.1.18 de compaction preservadas |
| Popup Bigger Context automático | launcher/src/App.tsx, teste renderer-wiring | UI original oferecia modal, fork o mantém fechado no startup |
| Interface e traduções | launcher/src/i18n.ts, languages.json, App.tsx | Localização base upstream combinada com nome do fork |
| Marca e canal independente | brand.cjs, profile.cjs, update.cjs, manifesto, ícones e smoke | Exclusivo do Infinity |
| Sessões e anexos persistentes | launcher-helper-client.ts, chatgpt-session.ts, testes IPC e anexos | Funcionalidades upstream recentes preservadas |
| Identidade durável Windows Local | broker-operation-identity.ts, integrations/windows-local/durable_command_jobs.py, instalador e testes Python | Persistência de screenshot_id, job_id, época do provedor e consulta de processo após reinício implementadas e testadas em cópia isolada. Instalação na fonte Windows Local real aguarda janela sem chamadas ativas. |

A documentação técnica anterior permanece nos relatórios de E:/Projetos/codex-native2-cloudflare-lab. Esse laboratório e os logs privados não são incorporados ao repositório público.
