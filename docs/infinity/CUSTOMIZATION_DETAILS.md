# Registro detalhado das personalizações

## Base de comparação

A auditoria considera a fonte personalizada `codex-chatgpt-web@6.1.13`, o runtime instalado 6.1.13, o upstream `miuuyy/codex-chatgpt-web` 6.1.18 e a branch `feature/continuos-infinity-native`. A base upstream `3b41eda2efa731245d171b51dbd30935e587c937` foi integrada pelo merge `3ed1c0aa7d524f0b690c21f84ac3835d9bdca9a3`. A atualização upstream `f08d16509e6a5447a0d0f2943abb172c69705160` foi integrada na worktree isolada pelo merge `fb1818c7470b64855a68b71238d43e25baae280a`. Os registros abaixo descrevem o motivo e o estado de validação de cada área.

## 1. Recuperação de resposta final e autorreparo in-band

- **Comportamento anterior** — o navegador podia aceitar o envio e depois deixar o turno sem uma resposta final reconhecível. A observação de progresso e o estado do DOM não garantiam a recuperação de todo erro terminal.
- **Problema** — o incidente `09aebeb1e208` terminou sem resposta final reconhecível. A hipótese de alerta ou controle tardio omitido foi investigada, sem ser promovida a causa comprovada.
- **Componentes** — `src/adapters/chatgpt-web/browser-response-structure.ts`, `browser-worker.ts`, `index.ts`, `in-band-auto-repair.ts` e o contrato IPC do helper.
- **Implementação** — a extração mantém os últimos 64 candidatos de resposta, incluindo controles tardios. O supervisor classifica falhas observáveis e, quando a chamada é segura, envia uma instrução de reparo dentro do turno atual. Chamadas de ferramenta pendentes, compaction e entrega desconhecida não recebem replay automático.
- **Equivalência upstream** — o upstream 6.1.18 fornece observação de progresso, recuperação de stall e fencing DOM. O reparo in-band por evento e a retenção dos candidatos finais são extensões do fork.
- **Necessidade** — recuperar falhas de apresentação e finalização sem reenviar cegamente a solicitação original.
- **Dependências e riscos** — depende de sinais atuais do navegador e de classificação conservadora. Um alerta ausente ou ambíguo continua exigindo análise. A causa do incidente histórico permanece não conclusiva.
- **Aceite** — `browser-live-progress.test.ts`, `browser-response-dom.test.ts`, `browser-stall-recovery.test.ts`, `in-band-auto-repair.test.ts`, `in-band-autorepair-ipc.test.ts` e `in-band-autorepair-runtime.test.ts` passam na suíte integral.

## 2. Reconstrução e validação do CWD confiável

- **Comportamento anterior** — quando a metadata de um turno não fornecia um CWD utilizável, o adaptador não tinha uma fonte única e autenticada para recuperar o diretório da conversa.
- **Problema** — uma inferência pelo diretório do processo ou pela raiz mais próxima poderia direcionar ferramentas ao workspace errado, especialmente em worktrees, subagentes e conversas retomadas.
- **Componentes** — `environment.ts`, `thread-environment.ts`, `codex-rollout-environment.ts` e os leitores de homes Codex confiáveis.
- **Implementação** — o fork combina evidências do rollout nativo, do estado da thread e dos homes autorizados. Valida lineage, existência, identidade e mudanças concorrentes. Se a evidência for ausente, ambígua ou obsoleta, bloqueia a chamada e registra o incidente.
- **Equivalência upstream** — o upstream 6.1.18 melhorou a leitura do rollout nativo. O fork acrescenta a política de confiança entre homes, threads e subagentes.
- **Necessidade** — impedir execução em diretório incorreto e permitir retomada somente com ownership verificável.
- **Dependências e riscos** — exige acesso ao rollout e ao estado da thread. Não inventa um caminho quando as fontes divergem. Uma mudança de CWD durante a leitura invalida a evidência anterior.
- **Aceite** — `environment.test.ts`, `trusted-codex-homes.test.ts`, `trusted-preflight-incident.test.ts`, `trusted-preflight-recovery.test.ts`, `trusted-preflight-runtime.test.ts` e `subagent-environment-history.test.ts`.

## 3. Polling de ferramentas nativas acima de 90 segundos

- **Comportamento anterior** — uma operação longa podia exceder a janela inicial de espera e parecer parada enquanto o processo ainda trabalhava.
- **Problema** — encerrar a espera inicial não informa se o efeito externo terminou. Reenviar a operação poderia duplicar uma mutação.
- **Componentes** — `mcp-server.ts`, `turn-progress.ts`, o broker de chamadas e os fluxos de polling.
- **Implementação** — a chamada original recebe um recibo pendente e um identificador estável. O polling consulta a mesma invocação e entrega o resultado original quando disponível.
- **Equivalência upstream** — o upstream possui scheduler e limites de ferramenta. O fork adapta a janela de espera e a recuperação do resultado ao protocolo nativo usado pelo conector.
- **Necessidade** — manter ferramentas longas observáveis sem reenviar a operação.
- **Dependências e riscos** — depende de o processo provedor continuar acessível e de o identificador de operação permanecer válido. O polling não prova reconciliação depois de um crash do provedor.
- **Aceite** — `long-native-tool-polling.test.ts` e `long-native-tool-polling-over90.test.ts`. Um teste real do conector Windows Local iniciou um comando de 95 segundos, recebeu `job_id`, consultou a mesma operação e terminou com `LONG_TOOL_COMPLETED` e código zero.

## 4. Lease de upload entre processos

- **Comportamento anterior** — helpers distintos podiam preparar uploads simultaneamente para a mesma conta e disputar o composer ou o estado de processamento.
- **Problema** — concorrência podia misturar arquivos, ultrapassar cotas ou fazer um turno assumir a conclusão de um upload alheio.
- **Componentes** — `attachment-upload-lease.ts`, `attachment-upload.ts` e o cliente helper do launcher.
- **Implementação** — um lease compartilhado serializa o trecho crítico entre processos. Cancelamento, expiração e abandono são resultados explícitos. O prompt não é reenviado quando a conclusão do upload é incerta.
- **Equivalência upstream** — o fluxo multipart do upstream é preservado. O lease entre processos é específico do fork.
- **Necessidade** — manter uploads físicos independentes em conversas concorrentes.
- **Dependências e riscos** — depende de armazenamento local compartilhado e de sinais de vida do processo. Não contorna limites externos de upload nem comprova cinco chats reais com anexos simultâneos.
- **Aceite** — `attachment-upload-lease.test.ts` executa cinco processos Bun independentes e verifica pares completos `start`/`end` sem intercalação. `attachment-upload.test.ts` cobre estados de processamento, falhas e cotas.
- **Evidência de uso real** — a auditoria de 06/11 registrou cinco chats simultâneos com ferramentas de leitura e resultados corretos em 5/5 sessões. Em teste separado, dois chats enviaram PNGs físicos independentes em paralelo e receberam as respostas esperadas em 2/2 turnos. Esses resultados não demonstram cinco chats com anexos físicos simultâneos.

## 5. Estrutura de resposta, streaming e controles tardios

- **Comportamento anterior** — a extração de candidatos DOM priorizava uma janela inicial limitada e podia deixar controles relevantes próximos ao fim de respostas extensas fora da inspeção.
- **Problema** — alertas, retry e estados de conclusão tardios podiam não entrar na classificação do turno.
- **Componentes** — `browser-response-structure.ts`, `browser-worker.ts`, `browser-helper-main.ts` e os contratos do helper.
- **Implementação** — a janela de candidatos conserva os itens finais, e o worker correlaciona progresso, controles e conclusão com o turno atual.
- **Equivalência upstream** — as melhorias de DOM, Mermaid e browser reset do upstream 6.1.18 foram incorporadas. A seleção dos candidatos finais continua sendo uma correção do fork.
- **Necessidade** — observar a resposta completa e evitar confundir texto citado ou histórico com controles do turno atual.
- **Dependências e riscos** — depende da estrutura DOM atual do ChatGPT. Mudanças de interface podem exigir atualização dos seletores e fixtures.
- **Aceite** — `browser-response-dom.test.ts`, `browser-live-progress.test.ts` e `browser-stall-recovery.test.ts`, incluindo uma resposta longa com 300 blocos Markdown e controles no final.

## 6. Identidade e seleção do conector Continuos

- **Comportamento anterior** — o produto herdado usava identidade genérica do conector e configurações orientadas ao túnel OpenAI.
- **Problema** — a identidade genérica não expressava a conexão `ContinuosWebIntegracao` nem o endpoint Cloudflare próprio.
- **Componentes** — `connector-identity.cjs`, `mcp-server.ts`, `config.ts`, `cloudflare-connector` e `continuos-connector`.
- **Implementação** — a identidade do produto e o nome do conector são configuráveis e validados. O transporte Cloudflare declara endpoint MCP, endpoint de saúde e identidade esperada do serviço.
- **Equivalência upstream** — o upstream mantém configuração genérica de conector e túnel. A identidade Continuos e o endpoint Cloudflare são específicos do fork.
- **Necessidade** — manter a integração com o serviço autorizado e permitir configuração por ambiente.
- **Dependências e riscos** — depende do endpoint Cloudflare, do OAuth gerido pelo conector e da identidade `ContinuosWebIntegracao`. Um health check HTTP não comprova autenticação nem execução de ferramenta.
- **Aceite** — `continuos-connector.test.ts`, `cloudflare-connector.test.ts` e o teste live do endpoint de saúde.

## 7. Supervisão de inicialização e recuperação do runtime

- **Comportamento anterior** — inicialização e dependências externas podiam ficar em estados parciais após reboot ou falha de um serviço.
- **Problema** — iniciar o launcher antes do agente Windows Local ou do gateway poderia deixar o runtime sem ferramentas, enquanto reiniciar componentes durante turnos ativos interromperia trabalho.
- **Componentes** — `launcher/electron/runtime-supervisor.cjs`, `main.cjs`, scripts de instalação e probes de saúde.
- **Implementação** — a sequência de inicialização verifica dependências e estados antes de disponibilizar o runtime. A supervisão usa eventos e sinais de saúde, preservando processos que ainda possuem trabalho ativo.
- **Equivalência upstream** — o upstream fornece o supervisor base de túnel. O fork amplia a ordem de inicialização e a recuperação do ambiente Windows/Cloudflare.
- **Necessidade** — reduzir falhas após reboot e evitar reinicializações cegas.
- **Dependências e riscos** — depende dos probes e do estado dos processos. O supervisor não pode concluir que um efeito externo terminou apenas porque um cliente perdeu a conexão.
- **Aceite** — testes `runtime-supervisor` do launcher, smoke de inicialização e validações históricas de reboot registradas em `ACCEPTANCE_MATRIX.md`.

## 8. Seleção GPT-6 Sol, Astra e esforço

- **Comportamento anterior** — o seletor herdado expunha os modelos e capacidades reconhecidos pela versão base.
- **Problema** — o catálogo e as opções de esforço não refletiam de forma consistente as capacidades de GPT-6 Sol e Astra disponíveis na conta.
- **Componentes** — `model-selection.ts`, `chatgpt-session.ts` e a integração do seletor no launcher.
- **Implementação** — o fork mapeia os nomes de modelo, disponibilidade por conta e esforço permitido, preservando o estado selecionado ao atualizar a sessão.
- **Equivalência upstream** — o picker estrutural do upstream 6.1.18 é mantido. O mapeamento de modelos e a disponibilidade Continuos complementam o seletor.
- **Necessidade** — apresentar apenas opções suportadas pelo contexto atual da conta e do modo.
- **Dependências e riscos** — depende do catálogo vivo e das permissões da conta. Um catálogo indisponível não deve ser interpretado como prova de que um modelo foi removido.
- **Aceite** — `chatgpt-model-selection.test.ts` e `chatgpt-session.test.ts`.

## 9. Mensagens nativas, subagentes e compaction

- **Comportamento anterior** — alterações no protocolo Responses e no parser podiam perder distinções entre mensagens, eventos de agente e estados de compaction.
- **Problema** — uma mensagem de subagente ou checkpoint podia ser interpretada como texto comum e degradar a retomada.
- **Componentes** — `responses/native-context.ts`, parser Responses, `server-compaction` e o ciclo Zero Risk MCP.
- **Implementação** — preserva os papéis e tipos de mensagem nativos, valida ownership e mantém checkpoints de compaction ligados ao turno correto.
- **Equivalência upstream** — as correções oficiais 6.1.18 para drafts, anexos e UUID de subagentes foram integradas. O fork mantém os controles de contexto e ownership adicionais.
- **Necessidade** — evitar perda de contexto e atribuição incorreta entre agente principal e subagentes.
- **Dependências e riscos** — depende do protocolo Responses atual. Eventos incompletos ou ownership divergente falham de forma conservadora.
- **Aceite** — `responses-agent-message.test.ts`, `server-compaction.test.ts`, `subagent-environment-history.test.ts` e `zero-risk-mcp-lifecycle.test.ts`.

## 10. Sessões e estado do navegador

- **Comportamento anterior** — o estado da sessão do navegador e o helper podiam divergir entre processos e entre chats.
- **Problema** — uma retomada podia usar a conversa errada ou perder o vínculo entre chat, turno e anexos.
- **Componentes** — `chatgpt-session.ts`, `launcher-helper-client.ts`, o helper Electron e o estado isolado do launcher.
- **Implementação** — mantém identidade e estado da sessão por chat, valida o helper que detém a operação e preserva os anexos associados ao turno.
- **Equivalência upstream** — as melhorias de drafts e anexos do upstream 6.1.18 foram integradas. A persistência e o lease de upload do fork complementam o fluxo.
- **Necessidade** — evitar cruzamento de estado entre chats e recuperar operações sem reenviar prompts.
- **Dependências e riscos** — depende da identidade do helper e do estado atual do navegador. Uma sessão encerrada ou ambígua não recebe replay automático.
- **Aceite** — `chatgpt-session.test.ts`, `launcher-helper-client.test.ts` e os testes de anexos.

## 11. DEV Full com external-cloudflare

- **Comportamento anterior** — `dev setup` aceitava `external-cloudflare`, mas `dev status` e `dev chat` consultavam `tunnelStatus` e exigiam credenciais de túnel local.
- **Problema** — o perfil DEV Full configurado para Cloudflare não conseguia reportar prontidão nem iniciar seu broker isolado.
- **Componentes** — `doctor.ts`, `dev-chat/cli.ts`, `dev-chat/transport.ts`, `setup.ts` e os testes DEV.
- **Implementação** — `inspectExternalGatewayHealth` centraliza timeout, resposta HTTP e identidade do serviço. Doctor, status e transporte DEV usam a mesma verificação. O transporte DEV aceita Cloudflare externo e mantém o broker local isolado.
- **Equivalência upstream** — não há implementação equivalente. É uma extensão do harness do fork.
- **Necessidade** — permitir que um perfil DEV use a configuração externa documentada sem depender de um túnel local.
- **Dependências e riscos** — a prontidão confirma saúde do gateway, não OAuth/PKCE nem execução real de ferramentas. As ferramentas do `dev chat` continuam simuladas.
- **Aceite** — `doctor-external-gateway.test.ts` cobre sucesso, HTTP 401 e identidade divergente. `dev-chat.test.ts` cobre o broker sem túnel. Um smoke com perfil temporário retornou `configured=true`, `mcpRuntime.required=true` e `ready=true` contra o endpoint real.

## 12. Bigger Context e controles de interface

- **Comportamento anterior** — a interface herdada podia apresentar o modal Bigger Context durante a inicialização.
- **Problema** — o popup podia interromper o fluxo inicial e alterar a interface antes de o usuário solicitar a função.
- **Componentes** — `launcher/src/App.tsx`, wiring do renderer e preferências experimentais.
- **Implementação** — mantém o modal fechado no startup e deixa a ativação sob controle explícito da preferência.
- **Equivalência upstream** — o upstream fornece o modal base. A política de startup é uma decisão do fork.
- **Necessidade** — evitar interrupção automática da sessão.
- **Dependências e riscos** — depende do estado de preferência e da disponibilidade da conta. Não altera o cálculo de contexto.
- **Aceite** — `renderer-wiring.test.ts`, testes de preferências e cobertura do Bigger Context em `dev-chat.test.ts`.

## 13. Localização e identidade visual

- **Comportamento anterior** — o produto herdava nome, textos e identidade visual Codex Web GPT.
- **Problema** — marca, canal de atualização e mensagens de interface não identificavam o fork Continuos Infinity.
- **Componentes** — `brand.cjs`, `profile.cjs`, `update.cjs`, manifesto, ícones, `launcher/src/i18n.ts` e `languages.json`.
- **Implementação** — mantém identidade, perfil de atualização e traduções próprias sem remover a estrutura de localização upstream.
- **Equivalência upstream** — a localização base é preservada. Marca e canal são específicos do fork.
- **Necessidade** — distribuir o fork como produto independente com identificação consistente.
- **Dependências e riscos** — o manifesto, o instalador e o canal de atualização precisam compartilhar a mesma versão e identidade.
- **Aceite** — `launcher-localization.test.ts`, testes de manifesto, renderer e smoke de pacote.

## 14. Runtime relocável e instalador Windows

- **Comportamento anterior** — o launcher empacotado dependia da estrutura de runtime produzida pelo build e de caminhos do ambiente de desenvolvimento.
- **Problema** — a instalação precisava provar integridade e relocabilidade dos arquivos, além de evitar reconstruir um runtime que estivesse em uso.
- **Componentes** — `scripts/prepare-runtime.cjs`, `scripts/build-runtime-bundle.ts`, `scripts/package.cjs`, `scripts/smoke-package.cjs` e o projeto Electron.
- **Implementação** — instala um runtime versionado, valida manifesto e dependências, gera checksums e executa smoke portátil. A compilação final foi feita em worktree isolada porque o runtime da worktree principal estava aberto pelo launcher DEV ativo.
- **Equivalência upstream** — o pipeline Electron base é mantido. A validação relocável e os controles do bundle são extensões do fork.
- **Necessidade** — produzir um instalador reproduzível sem tocar no runtime ativo.
- **Dependências e riscos** — depende de Bun 1.4.0, Electron 42.11.16 e electron-builder 26.15.3. O artefato validado permanece sem assinatura Authenticode.
- **Aceite** — `bun run verify`, `bun run app:package` e `bun run app:smoke` passaram. O smoke retornou `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. O instalador `launcher/artifacts/codex-continuos-infinity-6.1.18-continuos.1-win-x64.exe` do commit `7f9d123` tem 153.697.503 bytes e SHA-256 `D69AAD1CFE693E7E48524AF38B6661A0727171F9E03EB97C3BF3DCDF74860B7D`. O blockmap tem 160.889 bytes e SHA-256 `B16AEFC45E5B63F04D78F92FB461D11D754EB40B3CFFB48074ABE5B774A07BFD`. Authenticode retornou `NotSigned`.

## 15. Identidade durável do provedor Windows Local

- **Comportamento anterior** — o servidor real usa `activity_id` com `claim` e `activity_complete`, mantém `SHOTS` e `JOBS` em memória e não oferece reconciliação durável por chamada após crash.
- **Problema** — timeout do cliente não permite distinguir efeito concluído, processo ainda ativo ou operação sem resultado. Repetir uma mutação pode duplicar o efeito.
- **Componentes** — `broker-operation-identity.ts`, `broker-call-journal.ts`, `broker-call-reconciliation.ts`, `turn-broker.ts`, `index.ts`, `authenticated-broker-result-evidence.ts`, `integrations/windows-local/durable_command_jobs.py` e `apply-durable-command-jobs.ps1`.
- **Implementação** — o adaptador injeta `callId` como `operation_id` e a época do provedor quando o schema anuncia essas extensões. O schema pode declarar também `x-codex-operation-status`, vinculado a uma ferramenta de consulta que precisa declarar `x-codex-read-only=true`. O broker valida e persiste esse contrato junto aos eventos, revalida o contrato no despacho e, no preflight de recuperação, oferece uma consulta somente leitura apenas quando a época e o contrato atuais ainda correspondem ao journal. O wrapper Windows Local usa SQLite, hash de argumentos, PID, horário de criação e marcadores duráveis de início e saída. IDs repetidos com argumentos diferentes são recusados.
- **Equivalência upstream** — não há identidade durável por chamada no servidor Windows Local real. O ledger e as extensões de schema são específicos do fork.
- **Necessidade** — tornar o resultado de comandos acompanhados consultável após timeout e reinício, mantendo estados desconhecidos sem replay.
- **Dependências e riscos** — a fonte real `H:\Projetos\windows-local` ainda não recebeu o patch. O contrato de status cobre o wrapper PowerShell acompanhado, não processos destacados, ações de mouse/teclado ou serviços externos. Uma consulta `completed` confirma o estado do wrapper e seu código de saída, sem provar os efeitos de recursos externos. Estado desconhecido não autoriza repetição, e o preflight continua bloqueado até a reconciliação independente dos efeitos e um novo vínculo nativo autorizado.
- **Aceite** — 17 testes de `broker-operation-identity.test.ts`, dois testes de contrato do journal, `authenticated-broker-result-evidence.test.ts` e 29 testes Python. Typecheck e a suíte focada passaram. O E2E MCP em cópia isolada passou após reiniciar o servidor de teste com um comando ativo, reanexar por `windows_command_result`, confirmar exit code 0 e um único marcador durável, rejeitar argumentos diferentes para o mesmo `operation_id` e retornar `provider_changed` para época divergente. Dry-run contra a fonte real e apply/rollback em cópia descartável passaram. A instalação e o reinício do servidor real continuam pendentes.

## 16. Estado geral de aceite

O `npx --yes bun@1.4.0 run verify` executado no commit `3d06d59` terminou com código zero, com **1.344 aprovados, 114 ignorados e zero falhas** em 1.458 testes, 114 arquivos e 11.021 chamadas de `expect()`. A suíte do launcher teve **456 aprovados, quatro ignorados e zero falhas**. Typecheck, build Vite e smoke do runtime relocável passaram. O build registrou somente o aviso não bloqueante de bundle de 505,32 kB acima do limite de 500 kB.

O workflow de CI `43542322015` confirmou `actionlint`, `secret-scan`, Windows e Ubuntu com sucesso. O job Windows também passou pela validação PowerShell 5.1, `bun run app:package`, `bun run app:smoke` e teste de instalação e desinstalação NSIS em runner descartável. O job Ubuntu passou por `app:package`, verificação ABI do AppImage e smoke. O job macOS também concluiu `bun run verify`, `bun run app:package` e `bun run app:smoke` com sucesso. As etapas específicas de Windows e Linux foram ignoradas conforme a plataforma. A PR #1 permanece aberta em draft e mergeável, no commit `3d06d593c25af253feff9ecbc1a73ee5f691f111`.

A comparação GitHub do fork com `upstream/main` `f08d16509e6a5447a0d0f2943abb172c69705160` retornou 153 commits à frente e zero atrás, com 193 arquivos alterados. O pacote declara `6.1.18-continuos.1`. A consulta atual do catálogo retornou 30 ferramentas no namespace Codex app e 18 no namespace Windows Local. Os schemas ativos de `windows_command` e `windows_command_result` ainda não anunciam `operation_id` nem `provider_epoch`, e a fonte real Windows Local continua sem o ledger aplicado.

O perfil DEV Full isolado respondeu como configurado e pronto, mas o comando `dev chat` declara explicitamente que suas ferramentas são simuladas. Essa execução não comprova uma chamada MCP real pelo broker Infinity. A operação Windows Local de 95 segundos registrada anteriormente comprova polling no conector, mas não comprova que atravessou o broker Infinity. Permanecem pendentes a chamada MCP real pelo broker acima de 90 segundos, a reconciliação de efeitos externos depois de crash, o rebind do proprietário nativo após reinício, a concorrência real de 2/3/5 chats com anexos físicos independentes e a instalação/reinício do ledger no provedor Windows Local real.

O artefato Windows documentado anteriormente continua sem assinatura Authenticode. Nenhuma instalação de produção ou reinicialização de serviço foi realizada.
