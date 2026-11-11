# Auditoria do upstream

Em 10/11/2026, o upstream verificado era miuuyy/codex-chatgpt-web em 32fd343, release v6.1.18. A versão personalizada no laboratório era 6.1.13. A tag oficial 6.1.13 é 6f43747. O fork continuos-ti/codex-continuos-infinity preserva sua relação com o parent no GitHub.

A auditoria anterior registrou 28 alterações e 12 novos arquivos relativos ao arquivo de 25/10. A comparação posterior por texto normalizado detectou 38 diferenças. Foram integradas 36 modificações mais 12 arquivos novos ao ramo de desenvolvimento. Onze arquivos tiveram conflitos resolvidos preservando correções oficiais da 6.1.18.

## Validação e estado conhecido

| Verificação | Resultado |
| --- | --- |
| TypeScript raiz após merge | Passou |
| Runtime build 6.1.18-continuos.1 | Passou |
| Launcher build | Passou |
| Suíte launcher após branding | 436 aprovados, 4 ignorados, 0 falhas |
| Suíte completa de runtime após correções | 1.158 aprovados, 111 ignorados, 0 falhas em 1.269 testes |
| Suíte integral após reforço do CWD confiável (10/11/2026) | 1.162 aprovados, 111 ignorados, 0 falhas em 1.273 testes; `bun run verify` código 0 |
| Suíte integral com journal de preflight (10/11/2026) | 1.167 aprovados, 111 ignorados, 0 falhas em 1.278 testes (100 arquivos, 10.072 verificações); `bun run verify` código 0; ajuste posterior do campo de reconciliação: 169 testes dirigidos e TypeScript aprovados |
| Suíte integral do runtime com journal do broker (10/11/2026) | 1.182 aprovados, 111 ignorados, 0 falhas em 1.293 testes (102 arquivos, 10.156 verificações); refatoração posterior validada com 16 testes focados aprovados, 0 falhas, 88 verificações |
| Checagem de CWD real/junction após o commit `054fe42` (10/11/2026) | 175 testes dirigidos aprovados, 0 falhas (879 verificações); `bun run verify` integral concluído com código 0, incluindo typecheck, launcher e smoke runtime relocável |
| Instalação congelada de dependências | un install --frozen-lockfile passou no root e no launcher |
| Typecheck + teste de autorreparo + contrato do instalador + build renderer | 4 verificações concluídas com código 0 |
| Testes de regressão CLI/modelo | 63 aprovados, 1 ignorado, 0 falhas |
| Suite dev profile | 7 aprovados, 0 falhas |
| Testes dirigidos de autorreparo e polling | 173 aprovados, 0 falhas |
| Smoke do instalador Windows (build atual) | PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64, após `7z t` (extração isolada, sem instalação) |
| SHA-256 do instalador Windows (build local mais recente) | c20ec506c6733605b8807dae454fdc3de2bb0806c578e5814a4ec390767213c8 |
| Integridade de pacote local | `checksums-local.txt` gerado na compilação e validado pelo smoke; arquivo anterior desatualizado foi rejeitado como esperado |
| Assinatura digital Windows | Ausente |

O pacote Windows mais recente possui 153.675.718 bytes. A execução inicial da suíte teve 7 falhas. Após as correções, a nova execução integral passou sem falhas em 10/11/2026. A atualização dos instaladores e do README foi verificada em testes específicos, mantendo o canal de atualização separado. Os hashes locais são específicos de cada build; consultar sempre `launcher/artifacts/checksums-local.txt`. O smoke padrão agora valida o payload do instalador de modo portátil sem criar uma nova instalação per-user; o teste de instalação real permanece explícito em ambiente descartável.

Permanecem pendentes testes reais autenticados do conector, cinco chats paralelos, reinício controlado, crash de processo e recuperação automática quando o CWD continua não comprovado no preflight. O bloqueio já gera incidente persistente e sanitizado, sem conceder permissão. O arquivo do objetivo original em .codex/attachments é privado e não está incluído no fork.
