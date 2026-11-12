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
| DEV Full com transporte external-cloudflare | doctor.ts, dev-chat/cli.ts, dev-chat/transport.ts e testes doctor-external-gateway/dev-chat | Health check compartilhado valida HTTP e identidade do serviço. O DEV usa o transporte configurado sem exigir um túnel local. A checagem de saúde não comprova OAuth/PKCE nem execução real de ferramentas. |

A documentação técnica anterior permanece nos relatórios de E:/Projetos/codex-native2-cloudflare-lab. Esse laboratório e os logs privados não são incorporados ao repositório público.

## Auditoria de três vias do runtime instalado (12/11/2026)

A fonte personalizada arquivada em `E:/Projetos/codex-native2-cloudflare-lab/source/codex-chatgpt-web-main` declara `codex-chatgpt-web@6.1.13` e `bun@1.4.0`. Um build reproduzível dessa fonte, usando Bun 1.4.0 e saída temporária, gerou hashes SHA-256 idênticos aos artefatos do runtime instalado 6.1.13 para `package.json` (`4B519D0C3A76AD57EAC099BB2AC8779E55370A0568162AC07B768B19EB6C2279`), `bun.lock` (`298A89F9A9F050FBB7C4C839CC56966C1CB214C0369BC98221C6A262C6ADB6A0`), `cli.js` (`3A0F8CEA628A481355761A8FD72B62158A633B4224036C59121DBE308565BB82`) e `browser-helper.cjs` (`B1F6E1D2CBF985E7EFCAFF05C3FE29B047C6CB35A059EC7797165D2BABB9663E`).

O runtime de `C:/Program Files/Codex Web GPT/resources/runtime` corresponde byte a byte ao perfil `6.1.13-win32-x64` nos arquivos `manifest.json`, `app/package.json`, `app/bun.lock`, `app/cli.js`, `app/browser-helper.cjs` e `runtime/bun.exe`. O manifesto instalado declara `appVersion=6.1.13`, `bunVersion=1.4.0` e `bundleId=3c9d4c9b21fb1abb66acc46d484268bb9319bf2bd663fb5f7ccdd9a3a8614b9f`. A inspeção do processo pai confirmou que o `bun.exe` filho do `Codex Web GPT.exe` em execução carrega o runtime `6.1.13-win32-x64`.

O perfil `6.1.17-win32-x64` permanece armazenado, mas seus hashes de `package.json`, `bun.lock`, `cli.js` e `browser-helper.cjs` diferem dos artefatos ativos. Nenhum processo ativo observado utilizava esse perfil. O `resources/app.asar` instalado também declara o launcher `codex-web-gpt-launcher@6.1.13`.

O upstream consultado no GitHub tem a tag de release `v6.1.18` no commit `1cc49aaa627a995d3f0cf2f971fde7f764996649`. O `main` do fork começou no commit `32fd3436eb6ed94898b987a3c369003bb6fb8d54`. Em 12/11/2026, o `main` upstream avançou para `3b41eda2efa731245d171b51dbd30935e587c937`, e os nove commits entre essas referências foram integrados à branch `feature/continuos-infinity-native` pelo merge `3ed1c0aa7d524f0b690c21f84ac3835d9bdca9a3`. O merge preserva os dois pais, incluindo o histórico local `7504352999f94b8b7aac0371b56d6f2328ee1c66`. O branch do fork declara `codex-continuos-infinity@6.1.18-continuos.1` e acompanha o upstream por merge controlado.

Essa comparação comprova que a fonte personalizada 6.1.13 reproduz o runtime 6.1.13 atualmente carregado pelo launcher. O perfil 6.1.17 é uma versão retida, e o fork 6.1.18-continuos.1 está adiantado em relação à instalação ativa. A migração exige homologação própria do fork e drenagem dos turnos ativos.
