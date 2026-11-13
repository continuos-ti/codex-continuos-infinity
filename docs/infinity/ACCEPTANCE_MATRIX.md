# Matriz de aceite do Codex Continuos Infinity

### Classificação de CWD removido e revalidação — 13/11/2026

`MissingTrustedCodexEnvironmentError("existing cwd")` agora é classificado como `removed_or_invalid_cwd`. Uma pasta ausente ou inacessível bloqueia o preflight imediatamente. As duas releituras limitadas continuam reservadas à ausência temporária de autoridade de CWD, permissão ou rollout com identificadores nativos comprovados. Dois testes de regressão verificam a classificação e a ausência de retry para esse erro.

Nesta validação, os testes direcionados passaram com **9 aprovados, zero falhas e 38 asserções**. A suíte integral do runtime terminou com **1.339 aprovados, 114 ignorados, zero falhas e 11.001 asserções**, em 1.453 testes e 113 arquivos. O launcher terminou com **456 aprovados, quatro ignorados e zero falhas**. Typecheck da raiz e do launcher passaram, e os bundles do runtime e do launcher foram compilados. O Vite compilou 444 módulos e emitiu o aviso de tamanho de chunk acima de 500 KB. `git diff --check` passou.

O consentimento DEV e o turno autenticado do navegador já tinham sido observados nas verificações anteriores registradas abaixo. Esta rodada dispensou novo pareamento e não abriu Brave. Permanecem pendentes reconciliação independente de efeitos externos, rebind nativo após crash completo, concorrência física de anexos e instalação/rollback em staging. O PR #1 continua em draft.

### Reteste autenticação DEV Full e turno real do navegador — 13/11/2026

O perfil isolado `C:/Users/Administrador/.codex-continuos-infinity-dev-full` foi verificado pelo comando `dev status --json` usando `CODEX_CONTINUOS_INFINITY_DEV_HOME` explícito. O resultado confirmou `launcher.running=true` (PID 49360), `config.mode=full`, `config.purpose=dev-harness`, `mcpRuntime.required=true` e `mcpRuntime.ready=true`. O gateway DEV local (`127.0.0.1:28768/health`) e o endpoint dedicado Cloudflare (`https://codex-native2-dev.continuos.com.br/health`) responderam HTTP 200, identificando `ContinuosWebIntegracaoDev`, `isolated-dev` e `side_effects=false`. Nenhum novo pareamento, senha ou consentimento foi solicitado.

Um novo chat isolado `infinity-readonly-e2e-20261113` executou `dev chat` pelo código-fonte do Infinity, com o modelo `chatgpt-web/gpt-6-sol-instant`, exclusivamente para pedir `dev_ping` em leitura. O trace `60e8737638de` registrou `14-connector-selected`, uma única submissão aceita, mensagens de ferramenta concluídas no fluxo ChatGPT e resposta final confirmada por `browser_settled outcome=final`, seguida de `completionCommitted=true`. A resposta apresentou `status=ok`, `service=ContinuosWebIntegracaoDev`, `mode=isolated-dev`, `side_effects=false` e `production_dispatcher_loaded=false`. O processo encerrou com código zero. O erro anterior `Browser idle document did not commit within 10000ms` não se reproduziu nesse turno.

O journal local dessa execução terminou com `deliveredTools=0`, `activeMcpRequests=0` e `pendingTools=0`. Portanto, a evidência demonstra seleção do conector e resposta real no navegador, mas **não comprova um despacho de ferramenta pelo broker MCP local nem uma reconciliação independente de efeitos externos**. O gateway DEV não registra uma auditoria por chamada `dev_ping`, de modo que a alegação de exatamente uma chamada permanece dependente do fluxo observado no ChatGPT. A homologação de operação local via broker, pós-crash, anexos físicos concorrentes, instalação/rollback em staging e release assinada continua pendente. A instalação produtiva não foi modificada nesta execução.

### Diagnóstico do Infinity DEV Full — 13/11/2026

A aprovação OAuth/PKCE e o `dev_ping` direto do conector `ContinuosWebIntegracao DEV Web`, comprovados em 12/11, permanecem como evidências históricas válidas. Nenhum novo pareamento ou senha DEV foi solicitado nesta verificação.

Os checkpoints `11baf91a1557-c2599b66` registraram uma tentativa anterior com um conector selecionado que não correspondia exatamente à identidade DEV configurada, seguida de ausência do menu de menções. O seletor do `browser-worker.ts` foi ajustado para reconhecer `app://asdk_app_6af62965eba881918d00ee180cf36d44` no DEV Web e restringir o marcador específico do plugin de produção ao conector principal. O teste de regressão aceita o identificador DEV com o nome legado de apresentação e rejeita identificadores divergentes. Esta alteração ainda não foi comprovada no navegador real.

Os testes direcionados do navegador, da configuração de runtime e da CLI concluíram com **195 aprovados, zero falhas, 1.207 asserções**. O `typecheck` teve código de saída zero, os **135 testes** do `launcher/tests/browser-host.test.cjs` passaram e `git diff --check` passou.

O perfil isolado DEV Full apresentava launcher ativo e gateway MCP pronto antes do teste. Duas tentativas de chamada `dev_ping` pelo chat gerenciado do Infinity falharam **antes do envio** com `HTTP 400: Browser idle document did not commit within 10000ms`, nos traces `61ed49ebcc48` e `0667a08e621a`. O log do launcher confirmou `browser.tab_initialization_failed`. O reinício gracioso do launcher DEV e a recuperação pelo botão Retry também falharam na inicialização da superfície primária, com `browser.initialization_failed` e o mesmo erro. O experimento isolado de inicialização com `--disable-gpu` não corrigiu o problema. O protocolo de depuração expôs uma aba sem documento executável e não respondeu a uma avaliação simples de `document.readyState`, apontando para bloqueio na inicialização do renderer. A causa raiz permanece em investigação.

**Aceite pendente** — obter um launcher DEV operante, demonstrar a resposta real de `dev_ping` iniciada pelo fluxo Infinity e verificar o journal do broker. As tentativas observadas não produziram resposta MCP pelo Infinity, nem comprovaram execução de ferramenta externa. A produção e os perfis de autenticação não foram alterados.

### Verificação integral e correção de dependência — 12/11/2026

O GitHub confirmou a release upstream mais recente `v6.1.18` e o `main` em `f08d16509e6a5447a0d0f2943abb172c69705160`. A branch `feature/continuos-infinity-native` contém a integração desse commit pelo merge `b25e145`; a ancestralidade de `upstream/main` foi verificada localmente. O PR #1 segue aberto em draft, apontando para `main` do fork.

A auditoria de dependências sinalizou `@hono/node-server@2.1.3`. O override foi atualizado para `2.1.7` em `package.json` e `bun.lock`; `bun install --frozen-lockfile` e a auditoria subsequente passaram sem vulnerabilidades reportadas.

O preflight de CWD confiável agora emite comentários visíveis durante as duas releituras limitadas (150 ms e 300 ms), somente para identidade nativa de thread/turno e falhas recuperáveis. Cada tentativa reutiliza o mesmo resolver e repete a validação de roots, sandbox e existência do diretório. A recuperação confirma a retomada da tarefa original; a falha final informa o bloqueio antes do envio. Nenhum CWD é inferido, prompt aceito é repetido ou ferramenta MCP é despachada.

`bun run verify` terminou com **exit 0**: **1.322 aprovados, 113 ignorados, zero falhas e 10.949 asserções**, em 1.435 testes e 112 arquivos. Auditorias raiz/launcher, typecheck, testes do launcher, build Vite, bundle de runtime e `RELOCATABLE_RUNTIME_SMOKE_OK` passaram. Permaneceram avisos não bloqueantes de chunk Vite acima de 500 KB e uma resposta HTTP 502 isolada do catálogo de modelos durante o smoke.

Continuam pendentes o pareamento OAuth/PKCE manual do cliente ChatGPT, a chamada autenticada `dev_ping` iniciada pelo Infinity, testes reais de 2–5 chats com anexos físicos, instalação/reinício controlado do provedor Windows Local, reconciliação independente de efeitos MCP, novo vínculo nativo após crash e instalação/rollback em staging. A instalação produtiva 6.1.13 e os túneis compartilhados permaneceram intocados.


### OAuth/PKCE DEV concluído e smoke real do conector — 12/11/2026

O pedido iniciado às 19:24 expirou sem troca do código. Uma nova autorização foi criada às **20:21:50**, aprovada manualmente às **20:22:00** e teve o authorization code trocado às **20:22:05**. A auditoria foi consultada apenas para timestamps e nomes de eventos; nenhum segredo, chave, nonce, código ou token foi lido.

O conector real `ContinuosWebIntegracao DEV Web` foi exercitado após a autorização:
- `dev_ping` retornou `status=ok`, `service=ContinuosWebIntegracaoDev`, `mode=isolated-dev`, `side_effects=false` e `production_dispatcher_loaded=false`.
- `dev_echo` devolveu exatamente `codex-infinity-dev-smoke-20261112`.
- `dev_read_fixture("hello.txt")` leu somente a fixture fixa e retornou SHA-256 `d641e1b0bda1f43ffb34bae95cfed4802b64c7fc1d0b78030ccf8d89e0939254`.

Os três tools DEV estão disponíveis após OAuth. Isso comprova OAuth/PKCE e o transporte MCP do conector DEV isolado. **Não comprova ainda** o fluxo nativo do Infinity pelo broker local `ContinuosWebIntegracao`, nem as operações reais do Windows Local. O health DEV continua separado da produção, e POST anônimo em `/mcp` permanece 401. Nenhuma chave foi automatizada ou compartilhada; a produção não foi alterada.

### Diagnóstico da rejeição de pareamento DEV — 12/11/2026

O gateway isolado permaneceu em execução desde `16:13`, com a chave de pareamento gerada às `16:12`. O arquivo `gateway/pairing.secret` tem 48 caracteres ASCII e uma quebra de linha final, como produzido pelo inicializador. O servidor lê esse arquivo com `strip()` durante a inicialização. A auditoria local registrou `client_registered` às `18:02:32`, `dev_authorization_created` às `18:03:05` e `dev_pair_incorrect` às `18:04:34`, sem aprovação ou troca do código de autorização para esse pedido. Isso demonstra rejeição da entrada informada, mas não identifica o texto submetido nem comprova erro de configuração.

O código DEV agora ignora espaços e quebras de linha nas extremidades do valor informado, preserva o mesmo pedido de autorização após uma tentativa incorreta, mantém o limite de cinco tentativas e evita refletir a chave na resposta. O smoke hermético `integrations/dev-gateway/run_smoke.py` passou em um gateway efêmero com erro 403 para chave incorreta, formulário de nova tentativa, aprovação 303 com chave correta acompanhada de espaços e quebras de linha, OAuth/PKCE S256, revogação, rotação de refresh token e as três ferramentas DEV. O processo DEV ativo ainda executa a versão anterior até uma reinicialização controlada. A autorização do cliente ChatGPT real permanece pendente da entrada manual correta e de uma chamada MCP autenticada pelo Infinity.

### Verificação do conector DEV em 12/11/2026

O gateway isolado `https://codex-native2-dev.continuos.com.br` respondeu HTTP 200 em `/health` e nos dois endpoints públicos de metadata OAuth. O POST anônimo para `/mcp` retornou HTTP 401. O `smoke_oauth.py` executado contra o hostname público terminou com `DEV_GATEWAY_OAUTH_PKCE_MCP_SMOKE_OK`, cobrindo DCR, authorization code com PKCE S256, consentimento DEV já autorizado, rotação concorrente de refresh token, revogação, catálogo restrito e chamadas reais a `dev_ping`, `dev_echo` e `dev_read_fixture`. O serviço identificou `ContinuosWebIntegracaoDev` e `production_dispatcher_loaded=false`. Essa comprovação se refere ao cliente de teste DEV e ainda requer um turno autenticado iniciado pelo Infinity.

No navegador gerenciado, a rota privada `plugins_6af61e4b63e08191a1cf2f59fddfff50` mostrou o título exato `ContinuosWebIntegracao DEV`, um botão de exemplo e a ação `Open in desktop app`. Não havia botão `Try in chat`/`Testar agora`. Ativar o exemplo pelo DOM redirecionou para `/codex/open-app`, sem abrir o composer nem selecionar o conector. A tentativa anterior do worker falhou em `connector-directory-failed-try-in-chat` e `connector-menu-missing`. O adaptador agora reconhece esse estado e retorna erro explícito de conector indisponível para o ChatGPT web. **O E2E do conector DEV no ChatGPT web e o smoke Full do Infinity permanecem pendentes.**

### Estado atual da branch — 12/11/2026

A base funcional de runtime da branch está no commit `2109107828cd270528e8bc708787d7e62fb7711f` (`2109107`), que integra o upstream `f08d16509e6a5447a0d0f2943abb172c69705160` pelo merge `b25e1458b10bc86681b6525db722f26e36a33833`. O CI desse commit de runtime terminou com **5/5 jobs aprovados** no run `43261740629`. Windows, Ubuntu, macOS, actionlint e secret-scan passaram. O job macOS foi reenfileirado após cancelamento enquanto aguardava runner e concluiu com sucesso.

A validação local terminou com `bun run verify` exit 0, **1.299 testes aprovados, 113 ignorados e zero falhas** na suíte principal, **452 aprovados, quatro ignorados e zero falhas** no launcher, typechecks, build Vite e `RELOCATABLE_RUNTIME_SMOKE_OK`. A suíte Windows Local passou com **28/28 testes**, hashes do manifesto conferidos e dry-run aprovado. `bun run app:package` e `bun run app:smoke` passaram. O NSIS tem **153.698.263 bytes**, SHA-256 `8107dd1ad7d9b0881a182d9cf71361ae092020955d378a07d86621d923d2c805`. O blockmap tem **160.993 bytes**, SHA-256 `128f112144afcde0551682d1ec0e36819814543d4416af5eea96e9240c6001dd`. `7z t` retornou `Everything is Ok`, o smoke portátil passou e Authenticode está `NotSigned`.


### Integridade reproduzível do manifesto Windows Local — 12/11/2026

A suíte Python passou com **28 testes**, incluindo a verificação SHA-256 de todas as seis entradas do manifesto de integração. O checkout dos arquivos cobertos fixa LF em `.gitattributes`, inclusive com `core.autocrlf=true` no Windows, para preservar os hashes entre plataformas. O dry-run do instalador Windows Local passou sem modificar a fonte real nem reiniciar serviços.

Estado observado em 12/11/2026. A branch `feature/continuos-infinity-native` utiliza a versão `6.1.18-continuos.1`, derivada do upstream `miuuyy/codex-chatgpt-web` 6.1.18. A base inicial do fork era `32fd3436eb6ed94898b987a3c369003bb6fb8d54`, e o upstream `main` mais recente, `3b41eda2efa731245d171b51dbd30935e587c937`, foi integrado pelo merge `3ed1c0aa7d524f0b690c21f84ac3835d9bdca9a3`. O workflow `43154582839` do commit `5ec32d72d260ced17276ce563b1f43bf62a0ef4a` concluiu com cinco jobs aprovados, incluindo instalação e desinstalação NSIS em runner Windows descartável. O transporte Cloudflare configurável foi publicado no commit `b76511160838aa405a93a3cea9fc012a883afb60` e empacotado em worktree isolado. A homologação E2E autenticada permanece pendente.

### Conclusão atômica do ledger Windows Local — 12/11/2026

A integração staged `integrations/windows-local/` agora usa transação SQLite `BEGIN IMMEDIATE` ao confirmar o código de saída do PowerShell. Observadores concorrentes gravam o mesmo resultado ou recebem conflito explícito. Uma falha de inicialização não pode ser sobrescrita como conclusão. Três testes exercitam concorrência, idempotência e transição terminal, elevando a suíte a **28/28 aprovados**. Os hashes SHA-256 do manifesto foram recalculados a partir dos arquivos modificados e verificados pela suíte, com versão da integração `1.0.1`. O dry-run do instalador foi aprovado contra a fonte Windows Local atual. Aplicação no provedor real, reinício e aceite de efeitos externos permanecem pendentes.

O `bun run verify` desta árvore de trabalho concluiu com código zero, 1.299 testes principais aprovados e 113 ignorados, 452 testes do launcher aprovados e quatro ignorados, zero falhas, typechecks, build Vite e `RELOCATABLE_RUNTIME_SMOKE_OK`. Houve aviso de chunk Vite maior que 500 kB e HTTP 502 no catálogo durante o smoke, com a validação concluída.

### Transporte Cloudflare configurável — verificação de 12/11/2026

O checkout de desenvolvimento adicionou a seleção explícita `mcpTransport=external-cloudflare` no Automatic, os campos `externalGateway` validados, parâmetros de setup/DEV, tela de configuração, observação de health configurável e tratamento do túnel como serviço externo pelo supervisor. O Zero Risk continua usando `openai-tunnel` e pode reter o gateway preferido para o retorno ao Automatic. O perfil `browser-only` rejeita opções de transporte MCP. Novos cenários automatizados cobrem CLI, setup, runtime, supervisor e UI. O pacote desse commit passou em `app:package`, `app:smoke` e inspeção `7z t`. A mudança ainda requer instalação isolada de staging e validação OAuth/MCP real.

`bun run verify` terminou com **exit code 0**. A suíte raiz apresentou **1.274 testes aprovados, 113 ignorados, zero falhas e 10.649 asserções** em 109 arquivos. A suíte launcher apresentou **445 aprovados, quatro ignorados e zero falhas** em 449 testes. TypeScript, auditorias, build Vite, pacote runtime e `RELOCATABLE_RUNTIME_SMOKE_OK` passaram. O teste focado `tests/cli.test.ts` concluiu com **18 aprovados, zero falhas e 118 asserções**. O log integral local é `%TEMP%/continuos-infinity-verify-20261112b.log`. Há aviso não bloqueante de chunk Vite superior a 500 kB. A homologação nativa E2E ainda está pendente.

| Nº | Entregável do objetivo | Evidência verificável | Situação de aceite |
| --- | --- | --- | --- |
| 1 | Código-fonte personalizado | `src/adapters/chatgpt-web/`, `launcher/`, `scripts/` e commits no fork | **Parcial**. Reconciliação externa MCP e retomada autorizada após crash aguardam implementação e teste fim a fim. |
| 2 | Histórico de commits | Branch `feature/continuos-infinity-native` no GitHub | **Disponível**. Commits versionados e publicados. |
| 3 | Branch de integração e PR | PR #1 de `continuos-ti/codex-continuos-infinity`, em rascunho | **Disponível para revisão**. A integração à branch principal depende de homologação. |
| 4 | README próprio | `README.md` e READMEs localizados | **Disponível**. |
| 5 | Arquitetura | `docs/infinity/ARCHITECTURE.md` | **Disponível**. |
| 6 | Matriz das personalizações | `docs/infinity/CUSTOMIZATION_MATRIX.md` | **Disponível**. A aceitação funcional depende das verificações externas listadas abaixo. |
| 7 | Cloudflare e Windows Local | `docs/infinity/INTEGRATIONS.md`, `integrations/windows-local/` e código de integração | **Parcial**. A persistência de `screenshot_id`, `job_id` e época do provedor passou em 28 testes Python. O dry-run contra a fonte Windows Local passou. A fonte real permanece inalterada e o serviço continua em execução. OAuth, catálogo e chamada MCP autenticada iniciada pelo Codex no DEV continuam pendentes. |
| 8 | Supervisor por eventos | `docs/infinity/SUPERVISOR.md`, journal, broker e testes de recuperação | **Parcial**. O snapshot autenticado continua bloqueando retomada após crash. O provedor Windows Local agora tem código de consulta durável do processo e da época, ainda não instalado. Faltam reconciliação independente de efeitos mutáveis, novo vínculo nativo e fluxo produtivo de retomada. |
| 9 | CWD confiável | `docs/infinity/TRUSTED_CWD.md`, `tests/trusted-preflight-recovery.test.ts` e `tests/trusted-preflight-runtime.test.ts` | **Parcial**. Retries pré-envio limitados à mesma fonte nativa, comentários visíveis de recuperação ou bloqueio e journal privado têm cobertura de testes simulados. Falta homologação em sessão real com retomada após reinício e reconciliação externa de operações. |
| 10 | Instalação e configuração | `docs/infinity/INSTALLATION.md` e `EXAMPLE_CONFIG.md` | **Parcial**. O perfil browser-only mantém o smoke anterior. O perfil Full isolado foi inicializado e o BrowserHost criou seu descritor, mas `dev setup --full` expirou porque o login do ChatGPT no perfil Full não foi concluído. A configuração Full não foi gravada e o smoke real ainda está pendente. |
| 11 | Migração | `docs/infinity/MIGRATION_ROLLBACK.md` | **Disponível**. Migração produtiva ainda não executada. |
| 12 | Recuperação e rollback | `docs/infinity/MIGRATION_ROLLBACK.md` e `SUPERVISOR.md` | **Parcial**. Falta comprovar restauração de sessões reais após falha controlada. |
| 13 | Testes e evidências | `tests/`, `launcher/tests/`, `bun run verify` e testes focados de recuperação | **Parcial**. O CI `43154582839` no código `5ec32d7` aprovou `verify`, `app:package` e `app:smoke` em Windows, macOS e Ubuntu. A verificação integral local e os 52 testes focados de journal e evidência autenticada passaram. Faltam testes E2E de turno Codex autenticado no DEV. |
| 14 | Instalador Windows | `launcher/artifacts/` do worktree `E:/Projetos/codex-continuos-infinity-build-5ec32d7`; CI `43154582839` | **Parcial**. Build local com smoke portátil, checksums SHA-256 e `7z t` aprovados, Authenticode `NotSigned`. No Windows CI descartável, instalação e desinstalação NSIS passaram. Falta homologação funcional autenticada e rollback de versão no staging DEV. |
| 15 | CI e releases | `.github/workflows/ci.yml` e `release.yml` | **Parcial**. O run `43154582839` de `5ec32d7` terminou `completed/success` em `secret-scan`, `actionlint`, Windows, Ubuntu e macOS, incluindo instalação e desinstalação NSIS no runner Windows descartável. Nenhuma release foi publicada. |
| 16 | Manifestos e hashes | `launcher/artifacts/checksums-local.txt` e `THIRD_PARTY_NOTICES.txt` do build isolado | **Disponível para o build `2109107`**. NSIS de 153.698.263 bytes com SHA-256 `8107dd1ad7d9b0881a182d9cf71361ae092020955d378a07d86621d923d2c805` e blockmap de 160.993 bytes com SHA-256 `128f112144afcde0551682d1ec0e36819814543d4416af5eea96e9240c6001dd`. `7z t` e smoke portátil passaram. Authenticode `NotSigned`. |
| 17 | Diferenças com upstream | `docs/infinity/UPSTREAM_AUDIT.md` e `CUSTOMIZATION_MATRIX.md` | **Disponível** para a base 6.1.18. Futuras atualizações exigem nova comparação de três vias. |
| 18 | VS Code com extensão local | `local-personal.vscode-chatgpt-local` e ferramenta `vscode_windows` do ContinuosWebIntegracao | **Parcial**. A extensão está instalada e o projeto foi aberto em VS Code. O workspace está em Restricted Mode e a extensão declara suporte a workspace não confiável como `false`; a confiança do diretório precisa ser confirmada para ativá-la. |

## Validação adicional em 11/11/2026

Uma correção adicional em `native-rollout-call-evidence.ts` impede associar chamadas ou saídas MCP a um turno quando `internal_chat_message_metadata_passthrough` está presente, porém contém um proprietário inválido. O teste exercitou seis variantes malformadas tanto na chamada quanto na saída. Também foram rejeitados inícios duplicados e conclusões sem início correspondente de turnos paralelos, que poderiam ocultar sobreposição de proprietários em registros legados. Os testes focados `native-rollout-call-evidence.test.ts`, `authenticated-broker-result-evidence.test.ts` e `broker-call-journal.test.ts` terminaram com **57 aprovados, zero falhas e 264 asserções**. A verificação integral repetida após esta correção terminou com **código zero**, incluindo auditoria de dependências, TypeScript, testes de runtime e launcher, compilação e smoke de runtime relocável. A suíte launcher registrou **438 aprovados, quatro ignorados e zero falhas**. O CI do commit anterior `459e5e7`, run `43117496396`, concluiu com sucesso em actionlint, Ubuntu, macOS e Windows. A execução de ferramentas demoradas nesses testes foi simulada. A comprovação com MCP autenticado real no DEV e reconciliação de efeitos externos após crash continua pendente.

Em uma tarefa Codex conectada ao plugin `ContinuosWebIntegracao` já ativo no Windows, uma chamada local read-only de 96 segundos foi executada com o mesmo `session_id` durante os polls e terminou com **exit code zero**, registrando 96,03 segundos. Os endpoints públicos de health do gateway Cloudflare e do Windows Local responderam **HTTP 200**. Essa verificação comprova a continuidade do transporte do conector atual. A homologação do runtime do Infinity em DEV, incluindo OAuth/PKCE, catálogo e ferramenta MCP real acima de 90 segundos iniciada pelo fork, permanece pendente.

No worktree `feature/continuos-infinity-native`, a correção adicional de identidade da ferramenta em `native-rollout-call-evidence.ts` passou nos dois testes direcionados de evidência nativa e broker, com **33 testes aprovados, zero falhas e 104 asserções**. A execução completa de `bun run verify` terminou com código zero, incluindo auditoria de dependências, typecheck, testes, build e smoke de runtime relocável. Os runs PR `43099254982` e push `43099245246` do commit anterior `c74c7b6` concluíram com sucesso em `actionlint`, Ubuntu 24.04, macOS 15 e Windows. O run PR `43102321683` referente ao commit `0040eeb` também concluiu com sucesso em `actionlint`, Ubuntu 24.04, macOS 15 e Windows.

## Critérios ainda abertos

### Proteção adicional do perfil DEV (11/11/2026)

O perfil de desenvolvimento rejeita agora caminhos iguais, ancestrais ou descendentes dos perfis de produção Infinity, legado e Codex. A verificação considera aliases de diretório existentes, incluindo junctions do Windows, antes de iniciar o launcher. O ambiente filho limpa os overrides herdados de home Infinity e DEV, e o processo DEV fixa explicitamente `CODEX_CONTINUOS_INFINITY_HOME` no perfil isolado. O teste focado passou com **9 testes e 29 asserções**, e o `bun run verify` integral terminou com **exit code 0**, incluindo auditoria de dependências, TypeScript, testes, build Vite e `RELOCATABLE_RUNTIME_SMOKE_OK`. A suíte launcher registrou **438 aprovados, quatro ignorados e zero falhas**. A execução foi restrita à árvore de desenvolvimento e preservou a instalação produtiva.

A auditoria seguinte identificou uma divergência entre o caminho DEV exportado pelo CLI em `CODEX_WEB_GPT_DEV_HOME` e o caminho consultado pelo launcher Electron. O launcher agora reconhece os dois overrides DEV, verifica sobreposição com perfis de produção, homes nativos, dados do launcher e aliases reais, e restaura corretamente o ambiente original no relaunch. Os filhos DEV descartam overrides de produção herdados. Testes direcionados do launcher registraram **65 aprovados, zero falhas**, e `tests/dev-profile.test.ts` registrou **9 aprovados, zero falhas e 32 asserções**. A verificação integral Windows terminou com **exit code 0**, incluindo auditoria de dependências, TypeScript, runtime, build e `RELOCATABLE_RUNTIME_SMOKE_OK`; a suíte launcher registrou **440 aprovados, quatro ignorados e zero falhas**. O CI do commit anterior `4fd885d` (run `43128497722`) concluiu com sucesso em actionlint, Windows, macOS e Ubuntu, incluindo instalação NSIS descartável no Windows. Os testes completos do novo ajuste ainda precisam de confirmação no CI do próximo commit.

O aceite integral exige reconciliação independente dos efeitos externos de chamadas MCP já despachadas, inclusive no caso de resultado desconhecido, e aquisição de nova identidade de proprietário autorizada pelo protocolo nativo Codex após crash. O snapshot do rollout, os envelopes cifrados e a confirmação do broker oferecem evidência histórica e não provam isoladamente os efeitos externos. O bloqueio `broker_reconciliation_required` permanece ativo quando a reconciliação é desconhecida.

O teste DEV autenticado ainda deve comprovar OAuth/PKCE, catálogo MCP em turno nativo, GPT-6 Sol (Web) com ferramentas, anexos independentes, ferramenta MCP real acima de 90 segundos, CWD confiável e recuperação de falhas controladas. Foram verificados 3 e 5 chats simultâneos sem ferramentas, GPT-6 Sol em browser-only e compaction manual com retomada da memória factual no DEV. A sessão ChatGPT autenticada, a seleção visual de `ContinuosWebIntegracao` e o smoke do navegador foram verificados. A instalação produtiva deve continuar preservada durante a homologação.

## Observações do harness DEV em 11/11/2026

No perfil isolado `%USERPROFILE%/.codex-continuos-infinity-dev`, o launcher registrou `coreSetupComplete=true`, `browserSmokePassed=true` e `browserSmokeVersion=6.1.18-continuos.1`. O teste do navegador devolveu `CODEX WEB GPT READY` e o log registrou `smoke.completed` e `runtime.operation_completed`. O ChatGPT do navegador DEV mostrou sessão autenticada. `launcher-state.json` e `config.json` concordaram em `useTemporaryChats=false`, e as opções de aprovação automática, Bigger Context, anexos de skills e conversa nova obrigatória estavam desativadas.

O diretório local `.launcher-runtime/browser-helper.cjs` estava defasado e comparava a partição legada `persist:codex-web-gpt-dev-chatgpt`; a fonte esperava `persist:codex-continuos-infinity-dev-chatgpt`. A reconstrução do helper a partir da fonte e a substituição controlada enquanto nenhum processo helper estava ativo resolveram o erro de descritor. O smoke real passou após a substituição. Nenhum código-fonte versionado precisou ser modificado.

Para prevenir nova defasagem em sessões DEV longas, `launcher/scripts/dev.cjs` agora observa alterações das fontes e recompila o helper com debounce. `scripts/build-browser-helper.ts` compila primeiro em diretório temporário e só substitui o bundle existente após sucesso. Os testes `tests/browser-helper-dev-build.test.ts` verificam a identidade da partição compilada, a preservação do bundle anterior quando a compilação falha e a limpeza de arquivos de staging. A suíte completa de runtime, a suíte launcher, o typecheck e os testes direcionados passaram localmente. O watcher do launcher ainda requer uma observação ao vivo em uma sessão DEV iniciada com a nova versão do script.

Na UI do ChatGPT autenticado, `ContinuosWebIntegracao` estava instalado e o botão `Testar no chat` selecionou `@ContinuosWebIntegracao` no composer. Uma consulta estritamente de inventário foi enviada e retornou **zero ferramentas** por ausência do `turn_token` obrigatório no contexto de conversa direta. Trata-se de um teste manual fora de um turno Codex nativo, sem autorização para fabricar a credencial. A seleção visual do plugin foi comprovada, enquanto OAuth/PKCE e execução MCP pelo broker no DEV seguem sem homologação end-to-end.

O pacote de `e6ac948` está documentado em `INSTALLATION.md`, com SHA-256 do instalador `475e1e1fed7c4da467815c56fe7c4ffb1745079b58c52851e60a23e42235ce51` e SHA-256 do blockmap `8c8cb4f413a843eb0cd6c976422516694c9c96850dc98214ecb62a16b445239c`. O smoke portátil terminou com `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. Esses resultados validam o pacote isolado e seus contratos automatizados.

O novo pacote de `23a0147`, criado em `E:/Projetos/codex-continuos-infinity-build-23a0147`, concluiu `app:package` e `app:smoke` com código zero, além de `7z t` com `Everything is Ok`. Seu instalador tem 153.678.929 bytes e SHA-256 `06921b723a96b664d190304a345653dd22baff805cbe92e2151f31a141d8a9aa`. O blockmap tem 160.854 bytes e SHA-256 `6faf8a2b230a717000b8e49216e0fc74b8fbf17fab91e1e3eb79867210a5b386`. Ambos foram conferidos com `checksums-local.txt`. Authenticode permanece `NotSigned`. A validação de instalação real está pendente.

### Homologação de compactação real no navegador isolado

Em 11/11/2026, a conversa DEV `infinity-compaction-e2e`, configurada em `browser-only` com ChatGPT autenticado e `chatgpt-web/gpt-5.6-sol-instant`, recebeu o identificador fictício `INFINITY-COMPACTION-ORBIT-741` e respondeu `INITIAL CONTEXT STORED`. A execução interativa de `/compact` terminou com `browser_settled {"outcome":"final","compaction":true}` e `manual browser compaction completed (3 replacement items)`. Na mensagem posterior, a conversa devolveu exatamente `INFINITY-COMPACTION-ORBIT-741`, com `browser_settled` final. O CLI persistiu `turns=2`, `compactions=1` e `items=7` no perfil DEV. Essa evidência confirma preservação de informação simples em compaction browser-only; a compactação durante ferramentas MCP pendentes segue para homologação separada.

### Endurecimento das fronteiras de turnos e recuperação de cancelamento (11/11/2026)

`src/adapters/chatgpt-web/native-rollout-call-evidence.ts` rejeita uma conclusão nativa do turno alvo sem um início ativo correspondente, inclusive `task_complete` antecipado e conclusões duplicadas. `tests/native-rollout-call-evidence.test.ts` exercita ambos os casos e exige ausência de evidência autorizada de chamada MCP. O `bun run verify` completo no Windows encerrou com **exit 0** após esta mudança, com auditoria, typecheck, runtime, launcher (**438 aprovados, quatro ignorados, zero falhas**), build Vite e `RELOCATABLE_RUNTIME_SMOKE_OK`.

O CI do commit anterior `a8af862` passou no run de push `43119770989` em actionlint, Ubuntu, macOS e Windows. O run de PR `43119777479` falhou apenas no macOS, em `tests/browser-login.test.ts`, ao receber `The operation was aborted` no lugar da causa original `Chrome exited` fornecida pelo `AbortSignal`. `src/browser-login.ts` agora preserva a causa original quando o processo `osascript` é abortado. Após essa alteração, os três arquivos de testes focados no Windows registraram **47 aprovados, zero falhas, 124 asserções**, com TypeScript typecheck e `git diff --check` aprovados. A regressão específica de macOS requer confirmação pelo CI no commit que contém esta correção.

## CI e pacote isolado do commit `198ee4b` (11/11/2026)

O CI GitHub Actions run `43130666660` do commit `198ee4b1a86214af16daed03816e4cd58960a59e` concluiu com sucesso nos quatro jobs: `actionlint`, `verify (windows-latest)`, `verify (macos-15)` e `verify (ubuntu-24.04)`. A execução Windows incluiu o smoke de instalação NSIS em runner descartável.

Um worktree independente foi criado em `E:/Projetos/codex-continuos-infinity-build-198ee4b`, apontando para esse commit. `bun install --frozen-lockfile` concluiu nos projetos raiz e launcher. `bun run app:package` terminou com exit 0; `bun run app:smoke` retornou `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`; `7z t` encerrou com exit 0. O instalador Windows possui 153.679.414 bytes e SHA-256 `4f8bfd5c4477071a202e7fb58cb8e9fc12919838cde7368ac244463e7e035110`. O blockmap possui 160.847 bytes e SHA-256 `630caa44a9031a23831fdf267f8db353e77a410ebb50a968a671d89a7735c0c2`. Ambos coincidem com `launcher/artifacts/checksums-local.txt` desse worktree. Authenticode permanece `NotSigned`.

O pacote está disponível localmente para homologação de staging. Continuam abertos o E2E MCP autenticado iniciado pelo fork com OAuth/PKCE, a reconciliação independente de efeitos externos após crash, o rebind autorizado de turno, os cenários de anexos concorrentes e o rollback funcional de staging. O PR #1 permanece em draft.

### Correção de resolução de diagnósticos do autorreparo (11/11/2026)

O supervisor in-band utiliza agora `resolveChatGptBrowserDiagnosticsPath`, compartilhado com o browser worker. O diretório exibido na mensagem técnica acompanha `chatgptWeb.browserDiagnosticsPath` ou o diretório `diagnostics/browser-turns` do perfil ativo, evitando apontar o harness DEV para a pasta da instalação legada. O prompt omite caminhos que contenham controle de linha, URL, fragmento de credencial ou comprimento excessivo. Os testes direcionados anteriores registraram **157 aprovados e zero falhas**, e a execução integral de `bun run verify` após o ajuste terminou com **código zero**, incluindo auditoria, TypeScript, testes, build Vite e `RELOCATABLE_RUNTIME_SMOKE_OK`. Essa evidência cobre a resolução e sanitização dos caminhos, permanecendo pendentes a homologação E2E MCP Full e a reconciliação independente de efeitos externos após crash.

### CI e instalador isolado do commit `a1e0fe0` (11/11/2026)

No commit `a1e0fe09eb4484ae05503b1fbef27d251aeb6326`, os workflows GitHub Actions `43136492189` (PR) e `43136486892` (push) terminaram `completed/success`. Os quatro jobs de cada workflow foram concluídos com sucesso em `actionlint`, Windows, Ubuntu e macOS. Localmente, `bun run verify` havia terminado com código zero, incluindo auditoria, typecheck, testes, build e smoke relocável.

O worktree isolado `E:/Projetos/codex-continuos-infinity-build-a1e0fe0` gerou `launcher/artifacts/codex-continuos-infinity-6.1.18-continuos.1-win-x64.exe` (153.679.481 bytes, SHA-256 `42bab11b18c5d18c4f7c934720af56663005c2b5544019b08436cd7a363c9434`) e o arquivo `.exe.blockmap` (160.807 bytes, SHA-256 `a789ce96ff0a013b7ab511c4a8bc9bcf8132eaa4878570007980bb936d0edde7`). Ambos conferiram com `checksums-local.txt`, `bun run app:package` e `bun run app:smoke` passaram, com `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`, e `7z t` retornou `Everything is Ok`. O instalador segue `NotSigned`.

O perfil DEV foi consultado por `dev status --json` em 11/11/2026. O launcher isolado estava ativo no PID `71632`, o modo configurado era `browser-only` e `mcpRuntime.required=false`. A configuração Full depende de túnel e chave de runtime próprios do DEV. Continuam pendentes o E2E OAuth/PKCE com ferramenta MCP real iniciada pelo fork, a reconciliação independente de efeitos externos, o rebind de proprietário nativo após crash e a homologação funcional de instalação/rollback. A instalação produtiva permaneceu preservada.

### Verificação repetida no commit `5ad16d5` (11/11/2026)

No commit `5ad16d52c385dcb103949745f6c907085beeddf6`, os runs GitHub Actions `43138410251` (PR) e `43138402215` (push) concluíram como `completed/success`. Cada run teve sucesso em `actionlint`, `verify (windows-latest)`, `verify (macos-15)` e `verify (ubuntu-24.04)`. No checkout Windows limpo e sincronizado, `bun run verify` terminou com código zero, após as auditorias de dependências, checagens TypeScript, testes de runtime e launcher, build e `RELOCATABLE_RUNTIME_SMOKE_OK`. O PR #1 continuava aberto em modo draft.

Uma varredura adicional dos arquivos versionados com Gitleaks `v8.30.1` encontrou 18 alertas `generic-api-key`, todos localizados em `tests/` e `tests/fixtures/`. O relatório mascarado identificou os arquivos e as linhas, mas a natureza de cada ocorrência não foi confirmada. A inspeção de valores sem mascaramento foi recusada pela política da ferramenta. Esses alertas exigem classificação antes de configurar um bloqueio de CI que evite falsos positivos sem dispensar a detecção de segredos reais. Nenhum valor de credencial foi registrado nesta matriz.

Esta verificação preserva os critérios de aceite pendentes de MCP Full autenticado no DEV, reconciliação independente de efeitos externos, vínculo de proprietário nativo pós-crash, anexos concorrentes e rollback funcional em staging.

### Higienização dos identificadores de teste e bloqueio de segredos no CI (11/11/2026)

Os 18 alertas `generic-api-key` anteriores provinham de valores com aparência de credencial em identificadores usados por testes automatizados, inclusive dois atributos `data-turn-key` de fixtures HTML. Os 18 valores foram substituídos por identificadores determinísticos de baixa entropia que preservam os contratos de forma e de igualdade dos testes. Nenhum identificador original foi incluído neste relatório. Uma nova varredura com Gitleaks v8.30.1 sobre a cópia dos arquivos versionados atualizada com as alterações retornou **zero alertas** (`exit 0`). Os dez arquivos de testes relacionados retornaram **101 aprovados, 13 ignorados e zero falhas** após ajustar a identidade esperada no mock IPC.

O workflow CI inclui agora um job `secret-scan` com Gitleaks v8.30.1 e SHA-256 fixado para o executável Linux, que falha caso novos achados sejam encontrados. Essa evidência se limita ao conteúdo analisado na versão atual e não substitui a revisão de credenciais nem a reconciliação MCP pendente.

### Ordem temporal das evidências duráveis do broker (12/11/2026)

A reconciliação agora confere a ordem cronológica dos eventos persistidos em UTC para cada chamada MCP, incluindo as transições `queued`, `delivery_possible`, `result_received`, `compaction_resolution_possible` e `retired_uncertain`. Registros com fronteiras temporais invertidas tornam a recuperação indisponível para revisão, sem conceder execução repetida. Fixtures de leitura concorrente foram ajustadas para testar alterações de registro que continuam temporalmente válidas, preservando o objetivo de detectar mutações durante a leitura. Caso o relógio do sistema recue entre eventos legítimos, o leitor também falha fechado e requer reconciliação explícita.

Os três arquivos de testes focados de journal, propriedade e evidência autenticada passaram com **51 aprovados, zero falhas e 239 asserções**. O `typecheck` passou. A verificação integral `bun run verify` encerrou com **código zero**, incluindo auditorias, testes, compilação e `RELOCATABLE_RUNTIME_SMOKE_OK`. O launcher registrou **440 aprovados, quatro ignorados e zero falhas**. O CI anterior, run `43143341198` no commit `6b0836d`, concluiu com sucesso nos **cinco jobs** (`secret-scan`, `actionlint`, Windows, Ubuntu e macOS). A nova alteração ainda necessita confirmação no CI do próximo commit.

Permanecem pendentes a reconciliação independente dos efeitos externos, o novo vínculo de proprietário nativo após crash, a homologação OAuth/PKCE com MCP real no DEV Full, a concorrência de anexos e o rollback funcional de staging. O PR #1 continua em draft.

### CI e pacote Windows do commit `5ec32d7` (12/11/2026)

O workflow `43154582839` concluiu com **5/5 jobs aprovados**, incluindo varredura Gitleaks, actionlint e `verify`, empacotamento e smoke em Windows, Ubuntu e macOS. O job Windows aprovou também a instalação e desinstalação do pacote NSIS em runner descartável. O worktree isolado `E:/Projetos/codex-continuos-infinity-build-5ec32d7` produziu o instalador de **153.679.704 bytes**, SHA-256 **`2ef5f620e8b3b18d8d466b68c41d5736e65f66af7f437e2786ebd8448e823ef5`**, e blockmap de **160.765 bytes**, SHA-256 **`6a4127a03c943a7138abad235488c827cef86d19f770992c2f16215739038a56`**. Ambos conferem com o manifesto local e o instalador permanece `NotSigned`. `bun run app:smoke` retornou `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64` e `7z t` passou. Os testes focados de journal, propriedade e resultado autenticado registraram **52 aprovados, zero falhas e 242 asserções**.

Os critérios ainda abertos abrangem o E2E OAuth/PKCE e MCP Full iniciado pelo fork, reconciliação independente dos efeitos externos e novo vínculo de turno após crash, anexos concorrentes e restauração efetiva de staging. O PR #1 continua em draft até essas verificações.

### Diagnóstico autenticado no bloqueio de retomada (12/11/2026)

Ao encontrar chamadas persistidas de um broker anterior, o adaptador agora consulta o snapshot autenticado do turno nativo por meio de `ChatGptThreadEnvironmentStore`, com os mesmos homes confiáveis da recuperação de CWD. Os logs registram somente as contagens de chamadas, resultados selados e saídas nativas, ou a indisponibilidade da evidência. A consulta é diagnóstica e mantém o HTTP 409 `broker_reconciliation_required` com `retryable=false`. O snapshot conserva `replayAuthorized=false` e `externalEffectsReconciled=false`. A reconciliação independente dos efeitos externos e o novo vínculo de proprietário nativo após crash seguem pendentes.

Os testes focados `authenticated-broker-result-evidence.test.ts`, `zero-risk-adapter.test.ts` e `trusted-preflight-runtime.test.ts` passaram com **40 aprovados, zero falhas e 166 asserções**. A checagem TypeScript `tsc --noEmit` e `git diff --check` também passaram. A verificação integral `bun run verify` terminou com **código zero**, incluindo auditorias de dependências, TypeScript, testes, compilação e `RELOCATABLE_RUNTIME_SMOKE_OK`. A suíte do launcher registrou **441 aprovados, quatro ignorados e zero falhas**. Essas verificações simuladas não substituem E2E autenticado no DEV nem homologação de rollback.

### Pacote reproduzível do HEAD `c7e805e` (12/11/2026)

O código do commit `c7e805eb8ed15ac699060d55100aeeaf93da8c2e` foi empacotado em worktree independente com dependências instaladas por lockfile. `app:package` e `app:smoke` passaram, incluindo `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. `7z t` verificou o NSIS com `Everything is Ok`. O instalador de **153.681.133 bytes** tem SHA-256 **`4b9fb7ef596aaa9aaf2b476b753921e93813f0731d8ce86d2a4d86c4aba6d56f`** e o blockmap de **160.678 bytes** tem SHA-256 **`3497c43adaa516d7987670f5b5ebaee35d0a84dc0fc62b59667d4ca0cc758c40`**. Ambos conferem com `checksums-local.txt`. Authenticode retornou `NotSigned`.

O perfil DEV consultado em 12/11 permanece com launcher ativo, modo `browser-only` e `mcpRuntime.required=false`. O E2E Full autenticado iniciado pelo fork, as ferramentas MCP reais, os anexos concorrentes, a reconciliação externa, o rebind Codex pós-crash e a restauração de staging ainda não foram aprovados.

### Verificação do pacote Cloudflare no commit `b765111` (12/11/2026)

O commit `b76511160838aa405a93a3cea9fc012a883afb60` está publicado na branch de desenvolvimento e no PR #1. No snapshot desse commit, o upstream `main` estava em `32fd3436eb6ed94898b987a3c369003bb6fb8d54`. A atualização posterior para `3b41eda2efa731245d171b51dbd30935e587c937` foi integrada pelo merge `3ed1c0a`. O worktree isolado `E:/Projetos/codex-continuos-infinity-build-b765111` instalou as dependências por lockfile, concluiu `bun run app:package`, `bun run app:smoke` com `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64` e validou o NSIS com `7z t` (`Everything is Ok`).

O instalador Windows x64 tem **153.683.078 bytes**, SHA-256 **`70b7d8a58d95170465eab68eb481bf3f79385a9cdf50db04d23991243cab1975`**. O blockmap tem **161.196 bytes**, SHA-256 **`55b30bdcca71cb023bbfd2def34ddff536d0ad8a94ac3f158871e3d91d4773f1`**. Ambos coincidem com `launcher/artifacts/checksums-local.txt` desse worktree. `Get-AuthenticodeSignature` retornou **`NotSigned`**. O GitHub Actions `43170733150` concluiu com **cinco jobs aprovados**, incluindo `actionlint`, `secret-scan` e `verify` em Windows, macOS e Ubuntu. Não há comprovação de homologação MCP/OAuth do fork no DEV Full, reconciliação externa após crash, novo vínculo nativo de proprietário, anexos concorrentes nem rollback funcional de staging.

### Identidade durável de comandos Windows Local (12/11/2026)

O adaptador agora injeta o `callId` do broker em `operation_id` para ferramentas que anunciam `x-codex-operation-id=true`. Também injeta `provider_epoch` quando o schema publica `x-codex-provider-epoch`. A implementação Windows Local usa SQLite, hash dos argumentos, PID e horário de criação do processo, marcador durável de início e marcador de código de saída. Uma repetição do mesmo ID com argumentos divergentes é recusada.

Os testes `tests/broker-operation-identity.test.ts` passaram com **11 aprovados e zero falhas**. A suíte `integrations/windows-local/tests/test_durable_command_jobs.py` passou com **21 aprovados e zero falhas**, incluindo persistência do ID de captura, execução real do PowerShell, retorno nativo não zero, comando `exit`, erro terminante e reanexação a um processo ainda ativo depois de reconstruir o leitor do ledger. `bun run typecheck` passou. O dry-run do instalador passou contra `H:\Projetos\windows-local`. Apply e rollback também passaram em uma cópia descartável do `windows_control.py`.

A fonte real `H:\Projetos\windows-local` permaneceu inalterada e o serviço não foi reiniciado, pois havia chamadas Codex ativas. O contrato ainda precisa ser instalado em janela controlada e validado com `windows_command` real após reinício do servidor. A consulta de processo não prova efeitos de processos destacados ou serviços externos. O estado ausente continua não conclusivo e não autoriza replay. A reconciliação independente de efeitos MCP e o novo vínculo nativo Codex após crash permanecem pendentes.

### Verificação local do HEAD (12/11/2026)

`bun run verify` terminou com código **0**. A suíte principal executou **1.399 testes em 110 arquivos**, com **1.286 aprovados, 113 ignorados e zero falhas**, totalizando 10.666 chamadas a `expect()`. Os testes do launcher executaram **449 casos**, com **445 aprovados, quatro ignorados e zero falhas**. Os typechecks, o build Vite e o smoke do runtime relocável passaram. O build Vite manteve o aviso existente de um chunk JavaScript acima de 500 KB.

As validações adicionais passaram com **11 testes do adaptador**, **21 testes Python Windows Local**, dry-run contra a fonte real e apply/rollback em cópia descartável. A instalação do provider real, o reinício controlado e o E2E OAuth/PKCE continuam fora desta validação local.

### Auditoria do broker externo e CI atual (12/11/2026)

A comparação com o upstream confirmou a release `v6.1.18` no commit `1cc49aaa627a995d3f0cf2f971fde7f764996649` e, naquele snapshot, o `main` em `32fd3436eb6ed94898b987a3c369003bb6fb8d54`, com uma alteração de teste para estabilizar a verificação de túnel sob agendamento variável. Em 12/11, o upstream avançou para `3b41eda2efa731245d171b51dbd30935e587c937` e seus nove commits foram integrados pelo merge `3ed1c0a`. A alteração de teste anterior permanece em `launcher/tests/runtime-supervisor.test.cjs` no branch do Infinity.

O workflow de `push` `43189685693`, no SHA `073fcbf4e50ae3ed5f0a83dcb14ee9f410ede193`, concluiu com sucesso nos cinco jobs, incluindo `secret-scan`, `actionlint` e `verify` em Windows, Ubuntu e macOS. O workflow de `pull_request` `43189695839` para o mesmo SHA foi marcado como falha porque `verify (macos-15)` terminou como `cancelled`. Os outros quatro jobs passaram. A resposta da API não informou o motivo do cancelamento.

A execução local de `python -m unittest discover -s integrations\\windows-local\\tests -v` concluiu com **21/21 testes aprovados**. Os 21 casos incluem idempotência, reserva concorrente, época do provedor, estado desconhecido, marcadores duráveis, reanexação de processo e integridade dos hashes do manifesto.

A inspeção somente leitura dos health endpoints locais e públicos retornou HTTP 200 em Windows Local, gateway OAuth e proxy Responses. O `/healthz` informou `version=6.1.13`, `mode=full`, `accepting_turns=true`, `active_http_turns=4`, `active_browser_turns=2`, `successful_model_catalog_requests=579/587` e último resultado do catálogo HTTP 200 em 10:23:44 UTC. Nenhum serviço foi reiniciado e nenhuma chamada ativa foi interrompida.

A inspeção do broker externo identificou que `codex_cf_gateway_lab.py` usa `activity_id` com operações `claim` e `activity_complete` para proteger o ciclo de vida de uma chamada. Esse lease não fornece idempotência por chamada nem reconciliação de resultados após crash. A fonte ativa `H:\\Projetos\\windows-local` ainda mantém `SHOTS` e `JOBS` em memória, e `remote_server.py` encaminha chamadas com JSON-RPC `id=1`. O bridge Agent Desktop classifica timeout como entrega desconhecida e repetição insegura, sem uma consulta durável de estado.

A integração `integrations/windows-local/` do fork implementa um ledger SQLite para `windows_command` e metadados de `screenshot_id`, mas continua staged. O dry-run contra a fonte real e apply/rollback em cópia descartável passaram. A fonte real não foi alterada. O contrato cobre o wrapper PowerShell acompanhado e não reconcilia ações de mouse/teclado, processos destacados ou serviços externos. Outros provedores MCP ainda precisam implementar identidade, época e consulta de estado próprios.

Com quatro turnos ativos no proxy, a aplicação do patch ao provedor real e qualquer reinício permanecem pendentes de uma janela drenada. O broker do Infinity continua bloqueando retomada com HTTP 409 quando encontra chamadas anteriores sem reconciliação independente, mantendo `replayAuthorized=false` e `externalEffectsReconciled=false`.

### Concorrência de anexos por cinco processos (12/11/2026)

A regressão `tests/attachment-upload-lease.test.ts` agora inicia cinco processos Bun independentes, todos disputando o mesmo arquivo de lease. A sequência observada contém cinco pares completos `start`/`end` sem intercalação, e o arquivo de lease é removido após a conclusão. O teste passou no Windows com os cinco helpers em processos separados.

A suíte focada de `attachment-upload-lease.test.ts`, `attachment-upload.test.ts` e `browser-worker-contract.test.ts` concluiu com **155 aprovados, 12 ignorados, zero falhas e 903 asserções**. A auditoria real de 06/11 já havia comprovado cinco chats simultâneos com ferramentas de leitura e, separadamente, duas conversas com uploads físicos independentes de PNG. O teste de cinco processos comprova o lock entre helpers, mas não substitui um E2E de cinco chats com anexos físicos. Essa combinação real permanece pendente, sujeita também à cota externa de upload da conta.

### Instalador Windows produzido (12/11/2026)

O instalador foi empacotado a partir do commit `2e5580005a451d0062310d0e6db4b533646e18d5`, em worktree isolado, com Bun 1.4.0, Electron 42.11.16 e electron-builder 26.15.3. O build isolado evitou a pasta `launcher/build/runtime` bloqueada por processos Bun ativos no worktree principal. O artefato foi preservado em `launcher/artifacts/20261112/codex-continuos-infinity-6.1.18-continuos.1-win-x64.exe`, com **153.695.198 bytes** e SHA-256 `F1320D7601E4D46439B882CC830595F13D12F624FBB8B3BCE49661BB434C2EB3`. O blockmap tem SHA-256 `FDA52F599E6536E1B40547227699CF80D2F8824555C9B4BBB3536644C6EDE599`. O artefato anterior de 11/11 foi preservado.

O smoke local retornou `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. O workflow `push` `43196279369` concluiu os cinco jobs com sucesso. O job Windows passou pelo `app:package`, `app:smoke` e pelo teste NSIS de instalação e desinstalação em runner descartável. Ubuntu, macOS, `actionlint` e `secret-scan` também passaram.

O instalador está **sem assinatura Authenticode** (`Get-AuthenticodeSignature` retornou `NotSigned`). `CSC_LINK` e `CSC_NAME` não estavam configurados e não havia certificado Code Signing com chave privada nos stores CurrentUser/LocalMachine. O pacote é validado para instalação e smoke, mas a distribuição assinada ainda depende de provisionar um certificado de assinatura.

A tentativa 2 do workflow `pull_request` `43196286219` continua em fila somente no job `verify (macos-15)`. Windows, Ubuntu, `actionlint` e `secret-scan` passaram nessa tentativa. O mesmo SHA já passou pela matriz completa no workflow `push` `43196279369`; a tentativa PR ainda não tem resultado de execução para macOS.

### Integração controlada do upstream `3b41eda` (12/11/2026)

O upstream `miuuyy/codex-chatgpt-web` foi atualizado até `3b41eda2efa731245d171b51dbd30935e587c937`. A worktree isolada `E:/Projetos/codex-continuos-infinity-upstream-20261112` recebeu o merge automático, sem conflitos. A integração incorporou 9 commits upstream posteriores ao merge-base, em 17 arquivos, cobrindo restauração de drafts/anexos, preview Mermaid, listas UUID de subagentes, reset de dados do navegador incorporado e idioma do navegador.

Antes do commit, a worktree executou `bun run verify` com **código zero**. A suíte principal registrou **1.289 aprovados, 113 ignorados, zero falhas e 10.722 asserções** em 1.402 testes distribuídos por 110 arquivos. A suíte do launcher registrou **452 aprovados, quatro ignorados e zero falhas** em 456 testes. Typechecks, auditorias de dependências, build Vite e `RELOCATABLE_RUNTIME_SMOKE_OK` passaram. O aviso de chunk Vite superior a 500 KB permanece registrado.

O empacotamento isolado `bun run app:package` e o smoke `bun run app:smoke` passaram, com `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. O instalador `launcher/artifacts/codex-continuos-infinity-6.1.18-continuos.1-win-x64.exe` tem **153.697.450 bytes**, SHA-256 **`3674399D6F1F2EC59B4CEB6C5A627503FF8DB538354B7B46A7D7CC94FF3CBD6E`**. O blockmap tem **161.020 bytes**, SHA-256 **`5B87FA5D54481755026B07311AFBF21465853A93640335093D2ECF8D6E1A0610`**. Ambos coincidem com `checksums-local.txt`. Authenticode retorna `NotSigned`.

O merge foi consolidado no commit **`3ed1c0aa7d524f0b690c21f84ac3835d9bdca9a3`**, com pais `7504352999f94b8b7aac0371b56d6f2328ee1c66` e `3b41eda2efa731245d171b51dbd30935e587c937`. A branch `feature/continuos-infinity-native` avançou por fast-forward. A edição preexistente desta matriz sobre o snapshot de health foi preservada, com SHA-256 do arquivo idêntico antes e depois do merge.

Nos dois workflows anteriores ao merge, `push` **`43203958815`** e PR **`43203967522`**, os jobs de `actionlint`, `secret-scan`, Windows e Ubuntu concluíram com sucesso. O job `verify (macos-15)` aparece como `cancelled` em ambos. A consulta dos logs do job macOS do run de push retornou **GitHub API 404 BlobNotFound**, sem evidência suficiente da causa. Esta verificação CI se refere ao commit anterior, e o merge novo precisa de execução própria após publicação.

A homologação integral permanece pendente de integração MCP/OAuth Full iniciada pelo fork, confirmação da identidade durável pelo provedor Windows Local em operação real, reconciliação externa de efeitos, rebind do turno após crash, cinco chats com anexos físicos independentes e rollback funcional em staging. O PR #1 permanece em draft e a instalação ativa não foi alterada.

### CI e documentação — 12/11/2026

O commit `7f9d123adb6cee86e3065dbab5decbf255b49116` foi validado no workflow `push` `43214594469` e no workflow `pull_request` `43214601712`. Nos dois workflows, `actionlint`, `secret-scan`, Windows e Ubuntu concluíram com sucesso. Os dois jobs `verify (macos-15)` terminaram como `cancelled`, sem steps executados ou causa informada na resposta da API. A consulta independente das etapas do job de PR confirmou uma lista vazia. Nenhum novo workflow ou rerun foi solicitado nesta verificação.

A execução Windows do PR concluiu `bun run verify`, `bun run app:package`, `bun run app:smoke` e o smoke descartável de instalação/desinstalação NSIS. A execução Ubuntu concluiu `bun run verify`, empacotamento e smoke, incluindo a validação ABI do AppImage. O scan Gitleaks e `actionlint` passaram. A matriz macOS do commit permanece sem conclusão confirmada.

O PR `#1` permanece aberto em draft, com head `7f9d123adb6cee86e3065dbab5decbf255b49116` na consulta de 12/11. A documentação de personalizações detalhadas foi acrescentada em `CUSTOMIZATION_DETAILS.md` e está referenciada pela matriz. `git diff --check` concluiu com código zero antes do commit documental.

### Merge upstream `f08d165` validado em worktree isolada — 12/11/2026

Na worktree `E:/Projetos/codex-continuos-infinity-upstream-f08d165`, foi integrado o commit upstream `f08d16509e6a5447a0d0f2943abb172c69705160` pelo merge `fb1818c7470b64855a68b71238d43e25baae280a`. O conflito de importação em `tests/browser-worker-contract.test.ts` foi resolvido preservando os seletores de composer e effort e removendo o import não utilizado `legacyChatGptConnectorMigrationMessage`, que não existe na configuração do Infinity. Os testes direcionados passaram anteriormente com 180 aprovações e zero falhas.

Após instalar as dependências por `bun install --frozen-lockfile` no launcher, `bun run typecheck` e `bun run verify` passaram com código zero. A suíte principal teve **1.295 aprovados, 113 ignorados, zero falhas e 10.749 asserções**, totalizando 1.408 testes em 111 arquivos. O launcher teve **452 aprovados, quatro ignorados e zero falhas**. As auditorias de dependências não reportaram vulnerabilidades, o Vite compilou 444 módulos, e o smoke retornou `RELOCATABLE_RUNTIME_SMOKE_OK`. O Vite manteve aviso de chunk acima de 500 KB.

A fonte instalada permaneceu em `Codex Web GPT` versão `6.1.13`, conferida pelo manifesto em `C:/Program Files/Codex Web GPT/resources/runtime/manifest.json`. O SHA-256 de `resources/app.asar` observado nesta leitura foi `FDAAE12D73D8CEA2CDA043C8657EFE0455E079CAA4B1F5089413A89F9AA0066C`. A consulta ao log do job macOS do PR retornou `GitHub API 404 BlobNotFound`, e o job continuou `cancelled` sem steps. Esses testes são locais e não substituem os E2E OAuth/MCP, a concorrência de anexos físicos, a reconciliação externa e a validação de rollback em staging.

### Instalador e comparação com o runtime instalado — 12/11/2026

O merge `fb1818c7470b64855a68b71238d43e25baae280a` concluiu `bun run app:package` com código zero. O instalador NSIS `launcher/artifacts/codex-continuos-infinity-6.1.18-continuos.1-win-x64.exe` tem **153.697.820 bytes** e SHA-256 `E5FED10474A7B63119E72B33FA3E42E21C369500FDD3D15C34D5116E10A45C82`. O blockmap tem **160.953 bytes** e SHA-256 `3C006E87498998E40BFE8350377712D2759F60908089008B39D25FFE107150DE`. A verificação Authenticode do instalador resultou em **`NotSigned`**. `bun run app:smoke` concluiu com código zero e `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. Nenhuma instalação de produção foi efetuada.

No inventário da base personalizada `6.1.13`, 28 arquivos modificados e 12 novos foram comparados com o merge Infinity e o commit upstream `f08d165`. Todos os 40 caminhos existem no fork. Sete têm conteúdo idêntico à fonte personalizada, 32 têm conteúdo portado ou atualizado, e `src/chatgpt-session.ts` coincide com o upstream integrado. Igualdade ou diferença de hash por arquivo não substitui a revisão de comportamento descrita em `CUSTOMIZATION_DETAILS.md`.

A comparação dos manifests de runtime encontrou **6.032** entradas na instalação existente (`6.1.13`, bundle `3c9d4c9b21fb1abb66acc46d484268bb9319bf2bd663fb5f7ccdd9a3a8614b9f`) e **4.901** no pacote Infinity (`6.1.18-continuos.1`, bundle `538188e895a8dcd1702cea163a2300ade429414de469947ea601bd0c91f7dee6`). Os hashes de `app/cli.js`, `app/browser-helper.cjs` e `app/package.json` diferem, enquanto `runtime/bun.exe` coincide. Diferenças de contagem exigem revisão de inventário e dependências antes da migração.

O merge upstream foi incorporado à branch `feature/continuos-infinity-native` pelo commit `b25e145`. A verificação integral `bun run verify` realizada após essa incorporação terminou com código zero, incluindo auditoria de dependências, typechecks, testes de runtime e launcher (**452 aprovados, quatro ignorados, zero falhas**), build Vite de 444 módulos e `RELOCATABLE_RUNTIME_SMOKE_OK`. `git diff --check origin/feature/continuos-infinity-native..HEAD` passou. Durante o smoke, a consulta ao catálogo de modelos registrou HTTP 502, mas a execução concluiu com sucesso. Os endpoints `https://codex-native2.continuos.com.br/health` e `https://windows-local.continuos.com.br/health` responderam HTTP 200 em verificação somente leitura. Esses health checks não representam aceite OAuth/PKCE nem E2E autenticado.
### Validação do broker com época durável e DEV Full — 12/11/2026

O broker agora captura `x-codex-provider-epoch` no momento em que enfileira a chamada Windows Local, mantém a época no objeto interno da chamada e a persiste em cada evento do journal. A leitura do journal exige a mesma época em todos os eventos e o snapshot autenticado a devolve no inventário. Se a época mudar entre o enfileiramento e o despacho, a entrega é rejeitada. O journal continua sem argumentos ou resultados e a alteração mantém `replayAuthorized=false` e `externalEffectsReconciled=false` até uma consulta autoritativa ao provedor.

Após essa alteração, `bun run verify` terminou com **exit code 0**. A suíte principal executou **1.412 testes em 111 arquivos**, com **1.299 aprovados, 113 ignorados, zero falhas e 10.763 asserções**. A suíte do launcher executou **456 testes**, com **452 aprovados, quatro ignorados e zero falhas**. Typechecks, build Vite de 444 módulos e `RELOCATABLE_RUNTIME_SMOKE_OK` passaram. Permanecem o aviso não bloqueante de chunk acima de 500 KB e um registro HTTP 502 do catálogo durante o smoke, sem impedir o resultado final. A suíte focada de três arquivos de identidade, journal e evidência autenticada passou. A suíte Python Windows Local passou com **25/25 testes**, incluindo os hashes atualizados do manifesto. O dry-run do instalador contra `H:\Projetos\windows-local` também passou.

O gateway `codex-native2.continuos.com.br` respondeu HTTP 200 em `/health`. Os metadados OAuth anunciam `authorization_code`, `refresh_token` e PKCE `S256`. Uma chamada sem autenticação a `/mcp` respondeu HTTP 401, conforme esperado antes do fluxo OAuth. O perfil DEV Full isolado inicializou o BrowserHost e gravou seu descritor. A configuração `external-cloudflare` não foi salva porque o login ChatGPT não foi concluído no navegador DEV antes do timeout. O smoke autenticado e o catálogo/chamadas MCP reais permanecem pendentes.

A fonte real `H:\Projetos\windows-local` continua inalterada. O processo do provedor permanece em execução, o banco durável ainda não existe e o instalador foi executado apenas em dry-run. Apply e reinício aguardam uma janela confirmada sem chamadas ativas. A CI do commit `2109107` concluiu 5/5 jobs no run `43261740629`.

A extensão VS Code `local-personal.vscode-chatgpt-local` está instalada, mas o workspace continua em Restricted Mode. Como a extensão declara `untrustedWorkspaces.supported=false`, `vscode_windows` não encontra uma janela ativa até a confiança do diretório ser confirmada. O perfil DEV Full inicializou o BrowserHost, mas `dev setup --full` não salvou a configuração `external-cloudflare` porque o login ChatGPT não foi concluído. OAuth/PKCE, smoke autenticado e chamadas MCP reais permanecem pendentes.
### Recuperação do incidente `88a53f384c88` e DEV Full (12/11/2026)

O relatório sanitizado `INCIDENT_88a53f384c88_20261112.md` documenta envio aceito sem ação final de conclusão no navegador, reconciliação do worktree sem repetição de operações e a distinção entre falha do observador e conclusão comprovada. No perfil DEV Full isolado, a interface confirmou autenticação do ChatGPT e smoke do navegador. `dev status --json` confirmou configuração `mode=full`, `purpose=dev-harness`, transporte `external-cloudflare` e prontidão de MCP (`required=true`, `ready=true`). **OAuth/PKCE, conector DEV autorizado e chamada MCP real não estão homologados.**

O botão “Verify runtime” reproduziu um defeito: `devDoctor()` exigia credenciais do OpenAI Tunnel mesmo com transporte externo Cloudflare. A correção distingue os dois transportes, confere os campos do gateway e consulta sua saúde por um método já existente, falhando de forma fechada quando a configuração está incompleta ou o serviço não responde. A suíte `launcher/tests/runtime-host.test.cjs` passou com **66/66 testes**. A verificação integral `bun run verify` passou com código **0**: **1.317 aprovados, 113 ignorados, zero falhas** em 1.430 testes; launcher com **455 aprovados, quatro ignorados, zero falhas**; typecheck, build e `RELOCATABLE_RUNTIME_SMOKE_OK` aprovados. O Vite reportou o aviso não bloqueante de chunk superior a 500 KB, e o smoke registrou uma resposta 502 do catálogo sem impedir a aprovação. A correção está apenas no código de desenvolvimento; nenhum launcher ativo foi reiniciado nem a instalação de produção alterada.

### Auditoria de isolamento do gateway DEV — 12/11/2026

**Finding crítico:** o `externalGateway` gravado no perfil DEV usava `codex-native2.continuos.com.br`, hostname do túnel compartilhado `windows-local-mcp`, com origem local `127.0.0.1:28765` executando `codex_cf_oauth.py`. Logo, `mcpRuntime.ready=true` era somente evidência de health de um gateway de produção e não provava isolamento. O conector `ContinuosWebIntegracao DEV` não deve ser autorizado nesse endpoint.

O código agora rejeita o origin de produção em DEV Full, exige host DEV dedicado e origin comum para `/mcp` e `/health`, e falha antes de probe ou chamada. A regra está aplicada no setup, status CLI, transporte de DEV chat e doctor do launcher. A suíte dirigida passou com **97 aprovados, um ignorado, zero falhas** em 98 testes (170 assertions), incluindo testes para não gravar config, não abrir broker e não sondar o gateway de produção. A configuração DEV existente fica deliberadamente **não pronta** até existir gateway separado. Nenhum recurso Cloudflare de produção, processo ou sessão foi alterado.

Próxima etapa: provisionar túnel, hostname, processo OAuth/MCP, SQLite, chave de pareamento e dispatcher de ferramentas exclusivamente DEV; somente depois autorizar o conector DEV e validar OAuth/PKCE e uma chamada MCP de teste. O servidor de teste não deve importar nem despachar ferramentas Windows Local/Codex de produção.

### Retomada e verificação do gateway DEV e do plugin — 12/11/2026

Foi relido integralmente o objetivo `goal-objective.md` desta tarefa. O worktree permaneceu na branch `feature/continuos-infinity-native`, HEAD `71c16337f7882ffcd31f2a6091c11abfbf1fb52d`, com modificações existentes preservadas. `git diff --check` retornou zero, com avisos não bloqueantes de normalização LF/CRLF em documentos Markdown.

`bun run verify` concluiu com **exit code 0** no worktree principal, executando auditorias Bun de 105 e 345 pacotes sem vulnerabilidades reportadas, TypeScript, suíte principal, launcher (**456 aprovados, quatro ignorados, zero falhas em 460 testes**), build Vite de 444 módulos e `RELOCATABLE_RUNTIME_SMOKE_OK`. O build avisou sobre um chunk de 505,32 KB e o smoke registrou HTTP 502 na consulta ao catálogo de modelos, sem alterar o resultado de sucesso.

O gateway DEV público respondeu HTTP 200 em `/health` com `service=ContinuosWebIntegracaoDev`, com listener exclusivo em `127.0.0.1:28768`. O gateway de produção respondeu HTTP 200 com `service=ContinuosWebIntegracao`. Não foram realizados restart, deploy ou migração da produção.

No aplicativo ChatGPT para desktop, a página privada do plugin DEV exibiu `Testar agora`. O botão abriu uma tarefa Work com o prompt DEV sugerido. A tarefa foi enviada, pesquisou `dev_ping` no inventário e concluiu **“Teste DEV não executado”**, informando que nenhuma ferramenta `dev_ping` nem plugin `ContinuosWebIntegracao DEV` foram encontrados no catálogo disponível. O arquivo `gateway/oauth-events.log` não teve nova gravação após `17:41:37` durante essa tentativa, e nenhuma chamada MCP originada pela tarefa foi comprovada. A superfície desktop Work também permanece sem homologação do conector. A superfície web do composer continua sem seleção DEV comprovada, conforme o diagnóstico anterior de plugin `desktop-only` na rota privada.

O E2E iniciado pelo Infinity Full continua **pendente** até haver seleção autenticada inequívoca do conector DEV, execução real de `dev_ping` e resposta verificada. Os testes de concorrência real, recuperação após crash, restauração de staging e rollback também permanecem pendentes.

#### Plugin MCP Web criado, OAuth aguardando pareamento

No aplicativo ChatGPT para desktop, `Plugins > Adicionar > Adicionar servidor MCP personalizado` permitiu registrar o endpoint isolado `https://codex-native2-dev.continuos.com.br/mcp` sob o nome **ContinuosWebIntegracao DEV Web**, com OAuth, registro dinâmico de clientes (DCR) e escopo `codex.control`. A nova entrada apareceu na lista de plugins, foi acionado **Conectar** e o navegador Brave abriu a autorização do gateway DEV, solicitando exclusivamente a chave de pareamento DEV. A tentativa de preencher essa chave a partir do arquivo de estado local foi recusada pelas configurações de segurança da OpenAI, sem expor seu conteúdo. O formulário de autorização permaneceu aberto para conclusão manual do pareamento.

**Status:** plugin Web criado, OAuth ainda não concluído. O novo conector ainda não forneceu catálogo de ferramentas autenticado nem execução comprovada de `dev_ping` iniciada pelo ChatGPT Web ou pelo Infinity. Nenhum recurso de produção foi alterado.

### Verificação após hardening DEV — 12/11/2026

O `py_compile` dos três módulos do gateway passou. `python integrations/dev-gateway/run_smoke.py` concluiu com `DEV_GATEWAY_OAUTH_PKCE_MCP_SMOKE_OK` e `DEV_GATEWAY_LOCAL_E2E_OK`. O cenário cobriu rejeição anônima HTTP 401, DCR, rejeição de chave incorreta HTTP 403 com retry no mesmo pedido, rejeição de entrada Unicode inválida, pareamento com espaços/quebras de linha periféricos, authorization code com PKCE S256 e consumo único, rotação concorrente do refresh token, revogação do access token anterior, catálogo restrito às três ferramentas `dev_*` e chamadas autenticadas a cada ferramenta. O resultado confirmou `production_dispatcher=not_loaded` e `secrets=not_logged`.

A primeira execução passou por todas as asserções do smoke, mas terminou com `PermissionError` durante a remoção do diretório temporário porque o Windows manteve `oauth.sqlite` bloqueado por alguns instantes. `run_smoke.py` agora encerra o servidor antes de remover o estado e repete a limpeza em caso de bloqueio transitório. A segunda execução terminou com código **0** e removeu o diretório temporário.

`bun run scripts/verify.ts` terminou com **exit 0**. A suíte principal registrou **1.321 aprovados, 113 ignorados e zero falhas**, em 1.434 testes e 10.946 asserções. O launcher registrou **456 aprovados, quatro ignorados e zero falhas**, em 460 testes. Typechecks, auditorias de dependências, build Vite com 444 módulos e `RELOCATABLE_RUNTIME_SMOKE_OK` passaram. O build manteve o aviso não bloqueante de chunk JavaScript de 505,32 KB. O smoke browser-only registrou HTTP 502 isolado na consulta ao catálogo de modelos e concluiu com `RELOCATABLE_RUNTIME_SMOKE_OK`.

O `git diff --check` e o `git diff --cached --check` passaram. O único aviso foi a normalização LF/CRLF do Git no Windows. O gateway DEV público continua executando o processo iniciado antes do hardening e aguarda reinicialização controlada. O pairing manual do cliente ChatGPT, a seleção inequívoca do conector pelo Infinity e a chamada MCP real `dev_ping` continuam pendentes. A instalação e os túneis de produção permaneceram preservados.

### Pacote Windows após hardening DEV — 12/11/2026

`bun run app:package` terminou com código **0** e gerou `launcher/artifacts/codex-continuos-infinity-6.1.18-continuos.1-win-x64.exe`, com **153.700.526 bytes** e SHA-256 `CD96A880DCFAE72A17CB5BDC4E1CAF492BD7C2959DC3889AD6836E29D241DE78`. O blockmap tem **160.959 bytes** e SHA-256 `B80F3073D56E32867CAD10353484789533AF191476B94A905CDE67FD5CD07EC9`. `7z t` terminou com `Everything is Ok`. `bun run app:smoke` passou com `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. O executável está **NotSigned** por Authenticode. O pacote foi construído e testado em staging portátil, sem instalação ou substituição da versão ativa.

### Reinício isolado do gateway DEV — 12/11/2026

Após o smoke e a suíte completa, o processo antigo que atendia exclusivamente `127.0.0.1:28768` foi encerrado com a árvore de processos identificada como `integrations/dev-gateway/server.py`. Não havia conexões TCP estabelecidas. O gateway DEV foi iniciado novamente a partir do commit validado e respondeu localmente com `status=ok`, `service=ContinuosWebIntegracaoDev`, `mode=isolated-dev` e `side_effects=false`. O endpoint público DEV também respondeu 200. Os metadados OAuth anunciaram PKCE S256 e protected resource no hostname DEV. Um POST anônimo em `/mcp` recebeu HTTP **401**. A verificação de produção respondeu `service=ContinuosWebIntegracao`, confirmando que o processo e o túnel de produção não foram reiniciados nem modificados.

O novo processo escreveu um único `IncompleteFieldDefinitionWarning` de `pydantic_settings` sobre a anotação de `lifespan`, sem traceback ou falha de inicialização. As verificações local e pública de health permaneceram verdes.

As ACLs do diretório DEV, `pairing.secret`, `oauth.sqlite` e `cloudflared-token.txt` permitem acesso somente a `CONTINUOS-WORK\Administrador`, `BUILTIN\Administradores` e `NT AUTHORITY\SYSTEM`. Nenhum conteúdo de segredo foi lido ou registrado.

Na interface ChatGPT Desktop, `ContinuosWebIntegracao DEV Web` aparece instalado e habilitado. O botão `Conectar` na página de detalhes permaneceu desabilitado e não abriu um novo fluxo OAuth. Nenhuma nova autorização foi criada após o reinício. O pairing manual e a chamada MCP real pelo Infinity continuam aguardando a ação de conexão no composer do ChatGPT.

### Nova tentativa de descoberta e smoke após hardening — 12/11/2026

`py_compile` passou para `server.py`, `init_state.py`, `smoke_oauth.py` e `run_smoke.py`. A execução isolada de `run_smoke.py` terminou com código **0**, `DEV_GATEWAY_OAUTH_PKCE_MCP_SMOKE_OK` e `DEV_GATEWAY_LOCAL_E2E_OK`. O cenário confirmou rejeição anônima HTTP 401, DCR, PKCE S256, rejeição de chave incorreta e Unicode inválido, retry no mesmo pedido, pareamento com whitespace periférico, consumo único do authorization code, rotação concorrente do refresh token, revogação, catálogo restrito às três ferramentas `dev_*` e chamadas autenticadas. O processo temporário foi encerrado e seu diretório removido. `production_dispatcher=not_loaded` e `secrets=not_logged`.

Na interface privada do plugin, `Testar agora` abriu uma conversa Work com `ContinuosWebIntegracao DEV Web`. O ChatGPT informou que `dev_ping` não estava disponível e não executou o teste. Uma segunda tentativa na aba Chat, com o mesmo plugin selecionado no composer, exibiu `Não foram encontradas mensagens renderizáveis do ChatGPT nesta conversa`. O `oauth-events.log` não recebeu novos eventos em nenhuma das tentativas.

Uma leitura SQLite somente leitura e limitada a metadados mostrou dois clientes DCR, um cliente `ContinuosWebIntegracao DEV smoke` com consentimento de teste e um cliente `ChatGPT` sem consentimento ou tokens próprios. O pedido de autorização do cliente ChatGPT estava expirado. Nenhum valor de chave, segredo, authorization code, access token ou refresh token foi lido. O gateway DEV segue saudável, mas o catálogo autenticado ainda não foi entregue ao ChatGPT e nenhuma chamada MCP real `dev_ping` foi comprovada. A conexão OAuth do cliente ChatGPT e a homologação Infinity Full permanecem pendentes.

Os cinco jobs da CI do PR e os cinco jobs da CI de push do commit documental `c2dbeb6` concluíram com sucesso em Ubuntu, Windows e macOS, além de `actionlint` e `secret-scan`.

### OAuth iniciado pelo app no ChatGPT Web — 12/11/2026

O fluxo foi iniciado pela página do app no ChatGPT Web, em Plugins, pesquisando `ContinuosWebIntegracao DEV Web` e abrindo o aplicativo listado sob `ContinuosWebIntegracao`. O botão `Conectar` abriu a página `Authorize isolated DEV connector` com entrada manual da chave DEV. O caminho de conexão da página de detalhes no ChatGPT Desktop continuou desabilitado.

O gateway registrou `dev_authorization_created` às **19:24:13**. A requisição pendente está associada ao cliente ChatGPT, ao recurso `codex-native2-dev.continuos.com.br`, ao redirect host `chatgpt.com` e ao escopo `codex.control`. Na leitura de estado, a requisição tinha zero tentativas e cerca de 19 minutos restantes. Nenhuma chave foi lida ou inserida por automação. A página de pareamento permanece aberta para entrada manual pelo usuário.

O modal `Nenhuma ferramenta disponível para este app` apareceu antes da autorização. A documentação oficial do ChatGPT informa que, em apps OAuth, a autorização deve ser concluída antes de aguardar a varredura das ferramentas. A chamada real `dev_ping` continua pendente até concluir esse pareamento e a varredura do catálogo.

### Reutilização do consentimento DEV após autorização ChatGPT — 13/11/2026

Uma nova leitura somente leitura confirmou HTTP 200 em `https://codex-native2-dev.continuos.com.br/health` e em `http://127.0.0.1:28768/health`, ambos identificando `ContinuosWebIntegracaoDev`. O cliente DCR `ChatGPT` agora possui `trusted_consent` válido até **2026-12-13T02:55:29Z**. O identificador do cliente, o redirect URI registrado, o escopo `codex.control` e o recurso `https://codex-native2-dev.continuos.com.br/mcp` correspondem exatamente às condições de reutilização automática implementadas em `Provider.authorize`.

O último pedido de pareamento contém um redirect de autorização já concluído, mas expirou às **2026-11-13T03:15:22Z**. O authorization code associado expirou às **03:00:29Z**. Os eventos locais registram `dev_pair_approved` às **23:55:29** e `dev_authorization_code_exchanged` às **23:55:32** de 12/11. Portanto, a mensagem `DEV authorization request expired` corresponde ao pedido antigo já concluído e expirado. O consentimento persistido do cliente ChatGPT continua válido. Um novo pedido com a mesma identidade e os mesmos parâmetros deverá seguir a autorização automática, sem solicitar novamente a chave DEV. Nenhum novo pedido foi iniciado nesta verificação.

`integrations/dev-gateway/smoke_oauth.py` agora testa também uma segunda autorização após o pareamento inicial e exige o retorno direto ao redirect URI, sem passar por `/pair`. `run_smoke.py`, executado com o ambiente Python do laboratório, terminou com código **0**, `DEV_GATEWAY_OAUTH_PKCE_MCP_SMOKE_OK`, `trusted_consent_reuse=passed` e `DEV_GATEWAY_LOCAL_E2E_OK`. O teste utilizou estado temporário isolado e removeu esse diretório ao terminar. Nenhuma chave ou credencial do gateway ativo foi lida ou alterada.

A chamada `dev_ping` iniciada pelo broker do Infinity continua pendente de comprovação end-to-end. Na sessão ChatGPT desta verificação, os cinco vínculos disponíveis de `ContinuosWebIntegracao DEV Web` responderam `status=ok`, `service=ContinuosWebIntegracaoDev`, `mode=isolated-dev`, `side_effects=false` e `production_dispatcher_loaded=false`. No primeiro vínculo, `dev_echo` devolveu exatamente a mensagem enviada e `dev_read_fixture` leu `hello.txt` com sucesso. Isso comprova a autenticação e a execução direta das três ferramentas pelo conector ChatGPT. A integração do runtime Infinity com esse conector permanece pendente.

### Descoberta nativa das ferramentas DEV no Codex ativo — 13/11/2026

No turno nativo Codex vinculado ao conector `ContinuosWebIntegracao`, a primeira consulta ao catálogo por nome de ferramenta ainda não encontrou `dev_ping` porque o provedor estava no registro diferido. A descoberta nativa `tool_search` expôs exatamente as ferramentas `dev_ping`, `dev_echo` e `dev_read_fixture` do namespace `mcp__codex_apps__continuoswebintegracao_dev_web`. Uma segunda consulta ao inventário retornou schemas válidos para as três ferramentas.

As três chamadas MCP reais, feitas pela ponte do runtime Codex ativo e roteadas ao conector DEV, concluíram com sucesso. `dev_ping` retornou `status=ok`, `service=ContinuosWebIntegracaoDev`, `mode=isolated-dev`, `side_effects=false` e `production_dispatcher_loaded=false`. `dev_echo` retornou exatamente `infinity-runtime-dev-bridge-2026-11-13`. `dev_read_fixture` leu apenas `hello.txt` e retornou SHA-256 `d641e1b0bda1f43ffb34bae95cfed4802b64c7fc1d0b78030ccf8d89e0939254`. Nenhum novo OAuth, pareamento, Brave ou credencial foi usado nesta sequência.

O comando `dev status --json` do checkout Infinity confirmou `mode=browser-only`, `mcpRuntime.required=false` e launcher DEV parado, referenciando o PID anterior 71632. A evidência acima comprova a descoberta e a execução das ferramentas no runtime Codex atualmente conectado, incluindo o caminho de chamada do conector selecionado. O teste Full iniciado especificamente pelo binário do fork em staging ainda depende de um perfil DEV Full efetivamente iniciado, além dos critérios de concorrência, reconciliação externa e retomada pós-crash.
### Reconciliacao do incidente 5b67e1914d78 e contrato de inventario MCP - 13/11/2026

Os checkpoints `diagnostics/browser-turns/5b67e1914d78-2415e25c` confirmam envio aceito e resposta visivel, mas nenhuma resposta final verificavel. A observacao entrou em `response-stalled-60s`, a recuperacao no mesmo turno esgotou-se e `24-turn-failed.json` registrou `ChatGPT did not expose a final answer after same-turn observation recovery`. Uma segunda pasta isolada `5b67e1914d78-5badc229` tinha chegado a `19-response-visible` no momento da inspeção, sem conclusao comprovada. Esses checkpoints nao provam a causa da interrupcao nem efeitos MCP externos; nenhum prompt ou operacao anterior foi repetido.

Na auditoria do caminho `codex_tool_inventory` -> `browserToolParameters` -> `emitToolBatch` -> `attachBrokerOperationId`, foi identificada uma incompatibilidade objetiva: o schema de `windows_command` em staging marca `operation_id` e `provider_epoch` como obrigatorios, embora esses campos sejam propriedade do broker e injetados apenas no despacho nativo. O inventario voltado ao modelo agora omite os campos e as extensoes internas em uma copia do schema, preservando integralmente o contrato original do provedor para validacao no broker. A implementacao fica em `model-visible-tool-parameters.ts` e a regressao em `tests/mcp-browser-schema.test.ts`.

Evidencia desta retomada: `node node_modules/typescript/bin/tsc --noEmit` passou; 20 testes Node focados (17 de identidade e tres novos de inventario) passaram usando loader temporario de extensoes TypeScript, removido apos o teste; os 28 testes Python da integracao Windows Local passaram; `git diff --check` permaneceu limpo. `bun` nao estava disponivel no PATH do ambiente local observado; os testes que dependem de modulos `bun:` e a suite `bun run verify` nao foram executados com sucesso nesta retomada. A camada de producao, o navegador Brave, a autorizacao OAuth e o servico Windows Local nao foram alterados nem reiniciados.

A correcao do contrato de inventario e preventiva e **nao comprova a causa nem a resolucao do stall do navegador**. A fonte real do Windows Local segue sem o patch staging, e o schema observado de `windows_command_result` nao exige `provider_epoch`. Portanto o status read-only de uma chamada antiga nao pode ser considerado uma reconciliacao canonica por operacao e epoca. O HTTP 409 `broker_reconciliation_required` e o startup fence permanecem ativos; `replayAuthorized=false` e `externalEffectsReconciled=false` permanecem inalterados. Rebind nativo pos-crash, efeitos externos e E2E Full do fork continuam pendentes.

## Evidências atualizadas — 2026-11-13

### Integridade da base e comparação de versões

- O arquivo `upstream-main.zip` contém a base original 6.1.13, com 353 entradas. A auditoria escopada considera 286 arquivos rastreados, com 28 modificados, 12 novos e nenhum arquivo original ausente na fonte personalizada.
- A instalação produtiva continua na versão 6.1.13. O manifesto do runtime contém 6.032 arquivos. A verificação integral confirmou zero arquivos ausentes, zero divergências de tamanho e zero divergências SHA-256 tanto na instalação quanto no perfil persistido.
- O fork remoto é um fork verdadeiro de `miuuyy/codex-chatgpt-web`. A branch local `feature/continuos-infinity-native` está no commit `518759a98b74e74026702a8b68381c9fcaedf01b`, igual ao HEAD da PR #1.
- O upstream `main` está no commit `f08d165`. A referência local `upstream/main` é ancestral do HEAD atual. A branch está 134 commits à frente e zero commits atrás.
- A PR #1 permanece draft e mergeable. O workflow de CI associado ao HEAD atual, execução `43332740943`, terminou com sucesso.

### Validação executada

- `bun run verify` terminou com exit code 0. A suíte raiz aprovou 1.335 testes, ignorou 113 e não registrou falhas.
- A suíte do launcher aprovou 456 testes, ignorou 4 e não registrou falhas.
- `bun audit` verificou 105 pacotes e não encontrou vulnerabilidades.
- Os testes Python do Windows Local aprovaram 28 de 28.
- `integrations/dev-gateway/run_smoke.py` passou usando o ambiente virtual isolado do laboratório e estado temporário. A execução não alterou o banco OAuth do gateway ativo.
- O build Vite terminou com sucesso. Permanece o aviso não bloqueante de chunk JavaScript acima de 500 KB.

### DEV Full e consentimento existente

- O perfil ativo é `C:\Users\Administrador\.codex-continuos-infinity-dev-full`. O launcher já estava em execução no PID 20144.
- O perfil está em modo `full`, finalidade `dev-harness`, interação `automatic` e transporte `external-cloudflare`. O endpoint configurado usa o hostname dedicado `codex-native2-dev.continuos.com.br` e a identidade de serviço `ContinuosWebIntegracaoDev`.
- O comando de status confirmou `mcpRuntime.required=true` e `mcpRuntime.ready=true`. A saúde local em 127.0.0.1:28768 e a saúde pública do hostname DEV responderam com sucesso.
- A leitura SQLite foi feita em modo somente leitura. O consentimento do cliente ChatGPT para `https://codex-native2-dev.continuos.com.br/mcp`, escopo `codex.control`, permanece válido até 2026-12-12 23:55:29 BRT.
- O consentimento do cliente de smoke permanece válido até 2026-12-12 16:15:03 BRT.
- O único pedido pendente do cliente ChatGPT expirou em 2026-11-13 00:15:22 BRT. Isso explica a mensagem de solicitação expirada. O consentimento persistido do mesmo cliente continua válido.
- Nenhuma nova autorização foi iniciada e o Brave não foi reaberto. Nenhum valor de pairing key ou credencial foi lido ou exposto.

### Reconciliação dos turnos interrompidos

- O trace `c19a2b6d7627-bb3322a3` não possui mais diretório individual. O log do launcher preserva evidência de `send-accepted`, `response-visible` e `turn-completed`, sem evento `turn-failed`.
- O trace `c19a2b6d7627-ca5f0af6` preserva `send-accepted`, `response-visible`, `response-stalled-60s`, início de recuperação silenciosa, esgotamento da recuperação e `turn-failed`.
- A falha final registra que a resposta não foi observada após a recuperação e que o prompt original não foi reenviado. O trace não contém um registro estruturado de chamadas MCP. O perfil produtivo 6.1.13 também não possui um journal de broker correspondente. Os efeitos externos desse turno permanecem sem reconciliação independente.
- Nenhum dos dois prompts foi reenviado.

### Homologação E2E ainda pendente

- Os traces DEV anteriores confirmam sessão autenticada e composer pronto, mas a verificação do conector falhou em `connector-directory-failed-try-in-chat` e `connector-menu-missing`, após três tentativas de abrir o menu.
- A página de configurações de plugins exibida no launcher continua mostrando `Couldn't load plugin settings`. Não foi possível comprovar a seleção do conector DEV na interface do Infinity.
- A observação do Agent Desktop retornou `PERM_DENIED`, com erro de DACL em arquivo privado do próprio serviço. O controle Windows Local e as capturas de tela continuam disponíveis.
- O estado Full e a saúde do gateway estão prontos, mas ainda falta uma chamada MCP real originada pelo Infinity, com journal de broker e reconciliação do resultado. Os testes sintéticos do harness não substituem essa homologação.
- Permanecem pendentes a homologação E2E do broker, a reconciliação independente de efeitos externos, os testes concorrentes com anexos físicos, a instalação e reinicialização controlada em staging, o rollback e a validação integral do instalador e release.

### Confirmação de CI e reutilização da autorização DEV — 13/11/2026

- A branch `feature/continuos-infinity-native` permanece no commit publicado `5fb08c7eafd27fc2ff71ac351c64515ce64fb4e4`, com PR #1 aberto em draft. O `upstream/main` remoto continua em `f08d16509e6a5447a0d0f2943abb172c69705160`; o HEAD está 136 commits à frente e zero atrás desse upstream.
- O GitHub Actions run **`43421782922`**, associado a `5fb08c7`, concluiu com **5/5 jobs `completed/success`**: `verify (windows-latest)`, `verify (ubuntu-24.04)`, `verify (macos-15-intel)`, `actionlint` e `secret-scan`. Os três jobs de plataformas passaram pelos testes, pacote e smoke definidos no workflow; no Windows, a etapa de instalação e desinstalação NSIS no runner descartável também foi concluída.
- A ferramenta autenticada `dev_ping`, acessada pelo conector DEV conectado ao turno Codex atual, retornou `status=ok`, `service=ContinuosWebIntegracaoDev`, `mode=isolated-dev` e `side_effects=false`. A autorização existente foi reutilizada sem iniciar um novo pareamento.
- O launcher isolado DEV Full permaneceu ativo no PID `20144`, com `mode=full`, `purpose=dev-harness` e `mcpTransport=external-cloudflare`. O endpoint local `127.0.0.1:28768/health` respondeu `status=ok` e identificou `ContinuosWebIntegracaoDev`. Não houve reinício de gateway, launcher ou serviço produtivo durante esta verificação.
- Permanecem pendentes o E2E autenticado iniciado especificamente pelo binário Infinity Full, a seleção funcional do conector no navegador do Infinity, a reconciliação externa de efeitos MCP após falhas, o novo vínculo nativo após crash, os cenários reais de anexos concorrentes e a validação de migração/rollback em staging.

### Recuperação observada do DEV Full e consentimento preservado — 13/11/2026

- O launcher iniciado diretamente do código-fonte permaneceu ativo no PID `49360`. O log registra `browser.initialized` às 15:04:52 UTC, `dev_profile.ready` às 15:05:00 UTC e adoção do gateway Cloudflare às 15:05:02 UTC. O descritor `runtime/launcher-browser.json` foi recriado e a inspeção de liveness do browser host passou.
- O comando `dev status --json` com o perfil isolado DEV Full retornou `launcher.running=true`, `config.configured=true`, `mode=full`, `purpose=dev-harness` e `mcpRuntime.ready=true`. O smoke isolado do launcher do código-fonte retornou `ok=true`, `packaged=false` e `runtimeVerified=true`.
- Uma consulta SQLite exclusivamente em modo leitura constatou dois consentimentos DEV ainda válidos, com expiração máxima em 12/12/2026 às 23:55:29 BRT. Há um pedido de autorização pendente antigo, cuja expiração não revoga o consentimento persistido.
- O `dev_ping` pela conexão DEV Web já vinculada ao Codex retornou `status=ok`, `service=ContinuosWebIntegracaoDev`, `mode=isolated-dev` e `side_effects=false` na verificação atual, sem apresentar o formulário de pareamento.
- A verificação atual preservou o navegador DEV browser-only, o perfil DEV Full, o gateway e os vínculos OAuth. Nenhuma nova autorização ou pareamento foi iniciado, nenhuma pairing key foi lida e nenhum processo foi encerrado.
- O bootstrap do browser host teve falhas intermitentes `Browser idle document did not commit within 10000ms` antes de inicializar. A causa da intermitência ainda precisa ser isolada e o E2E real de `dev_ping` originado pelo navegador do Infinity Full continua pendente.

### Homologação pelo navegador do Infinity Full e journal DEV — 13/11/2026

- A causa da seleção incorreta do conector foi identificada no composer. `pressSequentially` digitava `@ContinuosWebIntegracao DEV Web` caractere a caractere e o ChatGPT selecionava o conector de produção `app://asdk_app_6ade222911a0819182d121f982c5a263` ao reconhecer o prefixo compartilhado. O sufixo `DEV Web` virava texto comum e o menu desaparecia.
- A seleção agora insere a consulta completa de forma atômica com `fill`, confirma a identidade exata do conector e aceita o pill DEV somente quando seu `app-mention-path` corresponde a `app://asdk_app_6af62965eba881918d00ee180cf36d44`. O diagnóstico DEV registra somente os atributos de identidade do conector para distinguir seleções incorretas.
- O E2E `infinity-dev-full-e2e-20261113` foi executado pelo CLI DEV Full usando o browser host ativo e GPT-6 Sol Instant. O trace `cee14221921f` alcançou `connector-selected`, `send-accepted` e `turn-completed`. `dev_ping` foi executado uma vez e retornou `status=ok`, `service=ContinuosWebIntegracaoDev`, `mode=isolated-dev`, `side_effects=false` e `production_dispatcher_loaded=false`.
- O transporte DEV Full agora habilita o journal durável em `<DEV_HOME>/diagnostics/broker-calls` antes de abrir o broker. O CLI passa o diretório raiz do perfil isolado. O teste `DEV chat attaches its broker...` cria uma chamada `dev_probe` e confirma a persistência dos eventos `queued`, `delivery_possible` e `result_received`, com `resultRecoverable=false` e `replayAuthorized=false`.
- A segunda homologação `infinity-dev-full-e2e-journal-20261113`, trace `86f97aeae7a3`, confirmou novamente a seleção do DEV Web e uma única chamada `dev_ping` com os mesmos cinco campos de sucesso. O diretório do journal e o arquivo SQLite de ownership foram criados. Esse `dev_ping` é um health tool do serviço DEV e não gerou evento de chamada no journal local. A persistência de eventos do broker está comprovada pelo teste de integração com `dev_probe`, enquanto a integração E2E de uma ferramenta local brokered continua pendente.
- Os testes focados executados após as alterações passaram com **178/178**, incluindo `browser-worker-contract`, `chatgpt-model-selection` e `dev-chat`. `tsc --noEmit` e `git diff --check` também passaram.
- A autorização DEV existente foi reutilizada. Nenhuma pairing key foi solicitada ou lida, o Brave não foi reaberto e nenhum processo produtivo foi reiniciado.
- Permanecem pendentes a chamada E2E de ferramenta local através do broker, reconciliação de efeitos externos após falhas, retomada nativa após crash, testes concorrentes com anexos físicos, instalação e reinicialização controlada em staging, rollback e validação integral do instalador e release.
- A validação ampliada posterior passou em `bun test ./tests` com **1338 aprovados, 114 ignorados e 0 falhas**. `launcher:typecheck`, `launcher:build` e `launcher:test` passaram com **456 aprovados, 4 ignorados e 0 falhas**. O `typecheck` e o `build` do runtime também passaram. O Vite reportou apenas o aviso de chunk principal acima de 500 kB. Os testes reais de DOM/Electron marcados como opt-in permanecem ignorados nesta execução.
- O pacote Windows NSIS foi reproduzido em `launcher/artifacts` e o smoke portátil passou com `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. O checksum SHA-256 do instalador foi verificado pelo smoke. O artefato anterior e seu checksum foram preservados em `launcher/artifacts/20261113-prepackage`. O novo instalador está **sem assinatura Authenticode** porque não havia certificado de assinatura configurado. O smoke não instalou o pacote no Windows e a instalação original permaneceu intacta.

### Reconciliacao do incidente 11ed8f534645 e identidade DEV estrita - 13/11/2026

- Os checkpoints do trace original comprovam send-accepted e response-visible, seguidos por stall, recuperacao de observacao na mesma aba e turn-failed, sem resposta final atestada. A recuperacao isolada tem segundo envio tecnico identificado; nao houve replay do prompt original.
- A causa exata do stall e os efeitos MCP anteriores seguem nao reconciliados; a ausencia de journal canonico nao pode ser usada para inferir ausencia de efeitos.
- Revisao preventiva do codigo eliminou o fallback permissivo de data-keyword para o DEV Web: sem app-mention-path com identidade exata, o pill nao confirma o conector. Um teste de regressao cobre esse caso.
- bun run verify, antes do pequeno hardening, terminou com exit 0: runtime 1338 aprovados / 114 ignorados / zero falhas; launcher 456 aprovados / 4 ignorados / zero falhas; typechecks, build e smoke passaram. Apos a correcao, typecheck e 161 testes focados passaram, 22 ignorados, zero falhas.
- Detalhes e limites: docs/infinity/INCIDENT_11ed8f534645_20261113.md. A tarefa geral permanece ativa e o ambiente de producao foi preservado.

### Retomada sem novo pareamento e limite da homologacao broker — 13/11/2026

- O perfil isolado DEV Full foi novamente consultado e retornou `launcher.running=true`, `mode=full` e `mcpRuntime.ready=true`. A verificacao reutilizou a sessao ja autenticada sem solicitar abertura do Brave, nova autorizacao, pairing key ou reinicio de servicos.
- O teste E2E `infinity-broker-e2e-20261113-1652`, trace `30063aca4436`, passou por `connector-selected`, `send-accepted`, `response-visible` e `turn-completed`. A conversa devolveu resposta final, sem executar o comando `Get-Date` solicitado para uma ferramenta simulada.
- O conector selecionado `ContinuosWebIntegracao DEV Web` disponibiliza apenas `dev_ping`, `dev_echo` e `dev_read_fixture`. `exec_command` nao esta em seu catalogo. A tentativa, portanto, nao validou o despacho pelo broker do Infinity. A inspecao confirmou `diagnostics/broker-calls` existente, com zero eventos persistidos no perfil DEV Full. Nenhuma chamada real de comando foi realizada nesse teste.
- `bun run verify` da execucao registrada em `%TEMP%/infinity-full-verify-20261113.log` passou com 1338 testes do runtime aprovados, 114 ignorados e zero falhas, mais 456 testes do launcher aprovados, 4 ignorados e zero falhas; o smoke `RELOCATABLE_RUNTIME_SMOKE_OK` tambem passou.
- A PR #1 do fork `continuos-ti/codex-continuos-infinity` foi confirmada aberta, em draft, mergeable, no commit `e127c5236c190a8fd6b4656d515b61875f654fcc`. Os runs GitHub Actions `43491606503` e `43491617250` tiveram os cinco jobs concluidos com sucesso.
- Continua pendente uma chamada E2E de ferramenta local que atravesse o broker do fork, com recibo e eventos duraveis. Permanecem pendentes reconciliacao externa autoritativa de efeitos MCP, rebind apos crash e homologacoes reais de concorrencia, instalacao e rollback.

### Revalidação do DEV Full, upstream e testes dirigidos — 13/11/2026

- O objetivo `goal-objective.md` foi lido integralmente antes da retomada. O perfil isolado DEV Full continua ativo no PID `49360`, com `config.configured=true`, `mode=full`, `purpose=dev-harness`, `mcpRuntime.required=true` e `mcpRuntime.ready=true`.
- Os endpoints de saúde local `http://127.0.0.1:28768/health` e público `https://codex-native2-dev.continuos.com.br/health` responderam HTTP `200`, identificando `ContinuosWebIntegracaoDev`, `isolated-dev` e `side_effects=false`.
- O consentimento ChatGPT existente havia sido confirmado por consulta SQLite somente leitura, válido até `2026-12-12 23:55:29 BRT`. O pedido pendente expirado é uma entidade separada. A documentação do gateway confirma que a expiração do pedido pendente não revoga o consentimento e que uma nova conexão reutiliza o consentimento quando cliente, redirect URI, escopo e recurso coincidem. Nenhuma nova autorização foi iniciada, nenhuma pairing key foi lida e o Brave permaneceu fechado.
- O GitHub confirmou `upstream/main=f08d16509e6a5447a0d0f2943abb172c69705160` e release upstream `v6.1.18`. A branch do fork e o HEAD da PR #1 estão no commit `14240e37432eb767e73eab02b03ff239e42c6b9b`. A PR continua aberta, draft e mergeable. O run de CI `43497036070` terminou `completed/success`.
- A validação dirigida com Bun `1.4.0` executou sete arquivos de teste relacionados ao journal do broker, evidência autenticada de resultados, identidade/status de operações, ambiente confiável, lineage de subagentes, homes Codex confiáveis e preflight de CWD. Resultado **264 aprovados, zero falhas e 1.201 asserções**.
- A inspeção do código confirmou que o journal e o cofre selado preservam evidência autenticada vinculada ao thread/turn nativos. As consultas de status do provedor só são oferecidas quando o contrato read-only, o namespace e a época ainda coincidem. O snapshot continua declarando `replayAuthorized=false` e `externalEffectsReconciled=false` até existir evidência autoritativa do provedor.
- Esta validação dirigida não conclui o E2E de ferramenta local pelo broker do fork. Permanecem pendentes a reconciliação externa autoritativa, o rebind nativo após crash, concorrência real com anexos físicos e instalação/rollback em staging.
### Homologacao NSIS instalada em staging isolado - 13/11/2026

- O pacote Windows NSIS foi reconstruido em workspace `launcher` com electron-builder `26.15.3`, Electron `42.11.16`, Windows `win32/x64` e versao `6.1.18-continuos.1`. O instalador gerado tinha `153709807` bytes.
- A instalacao usou um GUID NSIS exclusivo e um diretorio temporario em `%TEMP%`, com `runAfterFinish=false` e atalhos desabilitados. As chaves `HKCU\\Software\\<staging-guid>` e `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\<staging-guid>` apontaram para o diretorio temporario.
- O executavel instalado foi iniciado com `--launcher-smoke-test`. O marcador retornou `ok=true`, `packaged=true`, `runtimeVerified=true`, `version=6.1.18-continuos.1` e `platform=win32`.
- O desinstalador removeu o executavel, o diretorio de instalacao e as duas chaves de registro do staging. O processo do desinstalador nao forneceu um codigo de saida observavel pelo PowerShell, portanto a aprovacao foi baseada na verificacao posterior de ausencia de todos esses recursos.
- O staging temporario foi removido. A instalacao existente permaneceu em `C:\\Users\\Administrador\\AppData\\Local\\Programs\\Codex Continuos Infinity`, versao `6.1.18-continuos.1`, com timestamp do executavel `2026-11-11T00:31:28Z` e seis processos ativos no momento da verificacao. O registro de desinstalacao continuou apontando para a instalacao existente.
- O primeiro comando de build foi iniciado na raiz do repositorio e falhou porque o electron-builder leu o `package.json` errado. A execucao corrigida no workspace `launcher` concluiu o build e o ciclo de instalacao, smoke e desinstalacao.


### Incidente 65ac12f2ab27: última verificação de DOM para falta de controle final — 13/11/2026

- A auditoria dos checkpoints confirmou send-accepted, resposta visível, stall, recuperação de observação sem replay e erro terminal chatgpt_stalled_same_turn na instalação 6.1.13. Nenhum journal canônico do broker foi localizado para comprovar efeitos externos.
- O fork continha incompatibilidade demonstrável entre a mensagem retornada por ChatGptTurnDomHealthTracker.update e o filtro de erro que aciona a confirmação final de DOM. A função shouldRecheckChatGptSilentTurnFinalAnswer agora reconhece também o erro emitido pelo tracker.
- Os testes focados passaram: 159/159 com Bun 1.4.0, TypeScript tsc --noEmit e git diff --check concluídos com exit 0. A alteração é exclusiva da fonte isolada e não foi implantada em produção.
- O diagnóstico e suas limitações estão em docs/infinity/INCIDENT_65ac12f2ab27_20261113.md. A causa do stall original, os efeitos MCP desconhecidos e a homologação E2E Full continuam pendentes.
- Validação integral adicional do incidente: bun run verify exit 0; runtime 1339 aprovados / 114 ignorados, launcher 456 aprovados / 4 ignorados, builds e smoke relocável passaram. O aviso de chunk e a falha sintética HTTP 502 no catálogo não demonstram disponibilidade E2E do serviço.
