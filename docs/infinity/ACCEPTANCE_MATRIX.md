# Matriz de aceite do Codex Continuos Infinity

Estado observado em 11/11/2026. A base de código empacotada mais recente é o commit `e6ac948c89a413290deb1f56ab6ad362c9d1f26e`, versão `6.1.18-continuos.1`, derivada do upstream `miuuyy/codex-chatgpt-web` 6.1.18. Os builds de commits anteriores permanecem registrados como histórico de verificação.

| Nº | Entregável do objetivo | Evidência verificável | Situação de aceite |
| --- | --- | --- | --- |
| 1 | Código-fonte personalizado | `src/adapters/chatgpt-web/`, `launcher/`, `scripts/` e commits no fork | **Parcial**. Reconciliação externa MCP e retomada autorizada após crash aguardam implementação e teste fim a fim. |
| 2 | Histórico de commits | Branch `feature/continuos-infinity-native` no GitHub | **Disponível**. Commits versionados e publicados. |
| 3 | Branch de integração e PR | PR #1 de `continuos-ti/codex-continuos-infinity`, em rascunho | **Disponível para revisão**. A integração à branch principal depende de homologação. |
| 4 | README próprio | `README.md` e READMEs localizados | **Disponível**. |
| 5 | Arquitetura | `docs/infinity/ARCHITECTURE.md` | **Disponível**. |
| 6 | Matriz das personalizações | `docs/infinity/CUSTOMIZATION_MATRIX.md` | **Disponível**. A aceitação funcional depende das verificações externas listadas abaixo. |
| 7 | Cloudflare e Windows Local | `docs/infinity/INTEGRATIONS.md` e código de integração | **Parcial**. O ChatGPT autenticado do DEV apresenta e permite selecionar `@ContinuosWebIntegracao`. Uma consulta manual de inventário retornou ausência do `turn_token` nativo e zero ferramentas. Faltam OAuth, catálogo e chamada MCP autenticada iniciada pelo Codex no DEV. |
| 8 | Supervisor por eventos | `docs/infinity/SUPERVISOR.md`, journal, broker e testes de recuperação | **Parcial**. Falta reconciliação independente de efeitos mutáveis e novo vínculo nativo pós-crash. |
| 9 | CWD confiável | `docs/infinity/TRUSTED_CWD.md` e testes de preflight | **Parcial**. Testes automatizados disponíveis. Falta homologação em sessão real com retomada após reinício. |
| 10 | Instalação e configuração | `docs/infinity/INSTALLATION.md` e `EXAMPLE_CONFIG.md` | **Disponível**. Harness DEV isolado inicializado, navegador autenticado e smoke real aprovados. A validação funcional do pacote NSIS no staging permanece pendente. |
| 11 | Migração | `docs/infinity/MIGRATION_ROLLBACK.md` | **Disponível**. Migração produtiva ainda não executada. |
| 12 | Recuperação e rollback | `docs/infinity/MIGRATION_ROLLBACK.md` e `SUPERVISOR.md` | **Parcial**. Falta comprovar restauração de sessões reais após falha controlada. |
| 13 | Testes e evidências | `tests/`, `launcher/tests/`, `bun run verify` e testes focados de recuperação | **Parcial**. Verificação integral no commit `e6ac948` concluída com exit 0, launcher 438 aprovados e quatro ignorados. Em 11/11, o smoke do navegador DEV concluiu com `CODEX WEB GPT READY` e `smoke.completed`. Faltam testes E2E de um turno Codex autenticado no DEV. |
| 14 | Instalador Windows | `launcher/artifacts/` do worktree `E:/Projetos/codex-continuos-infinity-build-e6ac948` | **Parcial**. Pacote, smoke portátil e `7z t` passaram. Authenticode `NotSigned`. Falta uso real no staging. |
| 15 | CI e releases | `.github/workflows/ci.yml` e `release.yml` | **Parcial**. Run 43084585846 do commit `e7a715d` passou em actionlint, Windows e Ubuntu. O job macOS foi cancelado na primeira tentativa e teve reexecução solicitada em 11/11, aguardando resultado. Uma execução anterior, 43079404506, passou também no macOS. Nenhuma release foi publicada. |
| 16 | Manifestos e hashes | `launcher/artifacts/checksums-local.txt` e `THIRD_PARTY_NOTICES.txt` do build isolado | **Disponível para o build `e6ac948`**. Hashes SHA-256 e NSIS conferidos. |
| 17 | Diferenças com upstream | `docs/infinity/UPSTREAM_AUDIT.md` e `CUSTOMIZATION_MATRIX.md` | **Disponível** para a base 6.1.18. Futuras atualizações exigem nova comparação de três vias. |

## Critérios ainda abertos

O aceite integral exige reconciliação independente dos efeitos externos de chamadas MCP já despachadas, inclusive no caso de resultado desconhecido, e aquisição de nova identidade de proprietário autorizada pelo protocolo nativo Codex após crash. O snapshot do rollout, os envelopes cifrados e a confirmação do broker oferecem evidência histórica e não provam isoladamente os efeitos externos. O bloqueio `broker_reconciliation_required` permanece ativo quando a reconciliação é desconhecida.

O teste DEV autenticado ainda deve comprovar OAuth/PKCE, catálogo MCP em turno nativo, GPT-6 Sol (Web) quando disponível, duas, três e cinco conversas simultâneas, anexos independentes, ferramenta MCP real acima de 90 segundos, compaction, CWD confiável e recuperação de falhas controladas. A sessão ChatGPT autenticada, a seleção visual de `ContinuosWebIntegracao` e o smoke do navegador foram verificados. A instalação produtiva deve continuar preservada durante a homologação.

## Observações do harness DEV em 11/11/2026

No perfil isolado `%USERPROFILE%/.codex-continuos-infinity-dev`, o launcher registrou `coreSetupComplete=true`, `browserSmokePassed=true` e `browserSmokeVersion=6.1.18-continuos.1`. O teste do navegador devolveu `CODEX WEB GPT READY` e o log registrou `smoke.completed` e `runtime.operation_completed`. O ChatGPT do navegador DEV mostrou sessão autenticada. `launcher-state.json` e `config.json` concordaram em `useTemporaryChats=false`, e as opções de aprovação automática, Bigger Context, anexos de skills e conversa nova obrigatória estavam desativadas.

O diretório local `.launcher-runtime/browser-helper.cjs` estava defasado e comparava a partição legada `persist:codex-web-gpt-dev-chatgpt`; a fonte esperava `persist:codex-continuos-infinity-dev-chatgpt`. A reconstrução do helper a partir da fonte e a substituição controlada enquanto nenhum processo helper estava ativo resolveram o erro de descritor. O smoke real passou após a substituição. Nenhum código-fonte versionado precisou ser modificado.

Na UI do ChatGPT autenticado, `ContinuosWebIntegracao` estava instalado e o botão `Testar no chat` selecionou `@ContinuosWebIntegracao` no composer. Uma consulta estritamente de inventário foi enviada e retornou **zero ferramentas** por ausência do `turn_token` obrigatório no contexto de conversa direta. Trata-se de um teste manual fora de um turno Codex nativo, sem autorização para fabricar a credencial. A seleção visual do plugin foi comprovada, enquanto OAuth/PKCE e execução MCP pelo broker no DEV seguem sem homologação end-to-end.

O pacote de `e6ac948` está documentado em `INSTALLATION.md`, com SHA-256 do instalador `475e1e1fed7c4da467815c56fe7c4ffb1745079b58c52851e60a23e42235ce51` e SHA-256 do blockmap `8c8cb4f413a843eb0cd6c976422516694c9c96850dc98214ecb62a16b445239c`. O smoke portátil terminou com `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. Esses resultados validam o pacote isolado e seus contratos automatizados.
