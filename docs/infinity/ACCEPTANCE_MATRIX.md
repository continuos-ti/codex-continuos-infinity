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
| 7 | Cloudflare e Windows Local | `docs/infinity/INTEGRATIONS.md` e código de integração | **Parcial**. Falta demonstrar OAuth, conector selecionado e catálogo efetivo em sessão DEV autenticada. |
| 8 | Supervisor por eventos | `docs/infinity/SUPERVISOR.md`, journal, broker e testes de recuperação | **Parcial**. Falta reconciliação independente de efeitos mutáveis e novo vínculo nativo pós-crash. |
| 9 | CWD confiável | `docs/infinity/TRUSTED_CWD.md` e testes de preflight | **Parcial**. Testes automatizados disponíveis. Falta homologação em sessão real com retomada após reinício. |
| 10 | Instalação e configuração | `docs/infinity/INSTALLATION.md` e `EXAMPLE_CONFIG.md` | **Disponível**. A validação em staging permanece pendente. |
| 11 | Migração | `docs/infinity/MIGRATION_ROLLBACK.md` | **Disponível**. Migração produtiva ainda não executada. |
| 12 | Recuperação e rollback | `docs/infinity/MIGRATION_ROLLBACK.md` e `SUPERVISOR.md` | **Parcial**. Falta comprovar restauração de sessões reais após falha controlada. |
| 13 | Testes e evidências | `tests/`, `launcher/tests/`, `bun run verify` e testes focados de recuperação | **Parcial**. Verificação integral no commit `e6ac948` concluída com exit 0, launcher 438 aprovados e quatro ignorados. Faltam testes E2E autenticados. |
| 14 | Instalador Windows | `launcher/artifacts/` do worktree `E:/Projetos/codex-continuos-infinity-build-e6ac948` | **Parcial**. Pacote, smoke portátil e `7z t` passaram. Authenticode `NotSigned`. Falta uso real no staging. |
| 15 | CI e releases | `.github/workflows/ci.yml` e `release.yml` | **Parcial**. Run 43079404506 do commit `b795bbc` passou em actionlint, Windows, Ubuntu e macOS. Run 43083332275 do commit `e6ac948` estava em execução na consulta de 11/11. Nenhuma release foi publicada. |
| 16 | Manifestos e hashes | `launcher/artifacts/checksums-local.txt` e `THIRD_PARTY_NOTICES.txt` do build isolado | **Disponível para o build `e6ac948`**. Hashes SHA-256 e NSIS conferidos. |
| 17 | Diferenças com upstream | `docs/infinity/UPSTREAM_AUDIT.md` e `CUSTOMIZATION_MATRIX.md` | **Disponível** para a base 6.1.18. Futuras atualizações exigem nova comparação de três vias. |

## Critérios ainda abertos

O aceite integral exige reconciliação independente dos efeitos externos de chamadas MCP já despachadas, inclusive no caso de resultado desconhecido, e aquisição de nova identidade de proprietário autorizada pelo protocolo nativo Codex após crash. O snapshot do rollout, os envelopes cifrados e a confirmação do broker oferecem evidência histórica e não provam isoladamente os efeitos externos. O bloqueio `broker_reconciliation_required` permanece ativo quando a reconciliação é desconhecida.

O teste DEV autenticado deve comprovar, com perfil próprio, seleção de `ContinuosWebIntegracao`, OAuth/PKCE, GPT-6 Sol (Web) quando disponível, duas, três e cinco conversas simultâneas, anexos independentes, ferramenta MCP real acima de 90 segundos, compaction, CWD confiável e recuperação de falhas controladas. O estado de onboarding do launcher DEV ainda não comprova login ChatGPT, configuração MCP nem essas execuções. A instalação produtiva deve continuar preservada durante a homologação.

O pacote de `e6ac948` está documentado em `INSTALLATION.md`, com SHA-256 do instalador `475e1e1fed7c4da467815c56fe7c4ffb1745079b58c52851e60a23e42235ce51` e SHA-256 do blockmap `8c8cb4f413a843eb0cd6c976422516694c9c96850dc98214ecb62a16b445239c`. O smoke portátil terminou com `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. Esses resultados validam o pacote isolado e seus contratos automatizados.
