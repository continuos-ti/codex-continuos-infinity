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
| Instalação congelada de dependências | un install --frozen-lockfile passou no root e no launcher |
| Typecheck + teste de autorreparo + contrato do instalador + build renderer | 4 verificações concluídas com código 0 |
| Testes de regressão CLI/modelo | 63 aprovados, 1 ignorado, 0 falhas |
| Suite dev profile | 7 aprovados, 0 falhas |
| Testes dirigidos de autorreparo e polling | 173 aprovados, 0 falhas |
| Smoke do instalador Windows | PACKAGED_LAUNCHER_SMOKE_OK win32/x64 |
| SHA-256 do instalador Windows | 71cc5b9182fe853f62e022d5220c152ca076016ceabbbbfe019278d310fec44b |
| Assinatura digital Windows | Ausente |

O pacote Windows possui 153.672.928 bytes. A execução inicial da suíte teve 7 falhas. Após as correções, a nova execução integral passou sem falhas em 10/11/2026. A atualização dos instaladores e do README foi verificada em testes específicos, mantendo o canal de atualização separado.

Permanecem pendentes testes reais autenticados do conector, cinco chats paralelos, reinício controlado, crash de processo e CWD não comprovado no preflight de autorreparo. O arquivo do objetivo original em .codex/attachments é privado e não está incluído no fork.
