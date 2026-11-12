# Auditoria do upstream

Em 12/11/2026, a tag oficial `v6.1.18` aponta para `1cc49aaa627a995d3f0cf2f971fde7f764996649`, enquanto o `main` atual está em `32fd3436eb6ed94898b987a3c369003bb6fb8d54`, um commit posterior restrito à estabilização de um teste. O branch do fork usa `32fd3436...` como base upstream. A fonte personalizada e o runtime ativo permanecem na versão 6.1.13. A tag oficial 6.1.13 é 6f43747. O fork continuos-ti/codex-continuos-infinity preserva sua relação com o parent no GitHub.

A auditoria anterior registrou 28 alterações e 12 novos arquivos relativos ao arquivo de 25/10. A comparação posterior por texto normalizado detectou 38 diferenças. Foram integradas 36 modificações mais 12 arquivos novos ao ramo de desenvolvimento. Onze arquivos tiveram conflitos resolvidos preservando correções oficiais da 6.1.18.

## Histórico de validação até 11/11/2026

| Verificação | Resultado |
| --- | --- |
| Suíte integral em 11/11/2026 após `490db74` | `bun run verify` código 0; runtime 1.245 aprovados, 113 ignorados e zero falhas (1.358 testes, 107 arquivos); launcher 437 aprovados, 4 ignorados e zero falhas (441 testes); Vite 444 módulos e `RELOCATABLE_RUNTIME_SMOKE_OK` |
| Proteção do rebuild em 11/11/2026 | Teste novo passou, preservando o executável Bun e os arquivos do bundle quando o executável em uso fica dentro do diretório de saída; TypeScript e `git diff --check` passaram |
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

Permanecem pendentes a homologação OAuth/PKCE no DEV Full, cinco chats simultâneos com anexos físicos independentes, a chamada MCP real acima de 90s através do broker externo, o reinício controlado do provedor, o crash e a reconciliação após efeito externo, e a recuperação de CWD em compaction/restart no ambiente autenticado. O bloqueio atual gera incidente persistente e sanitizado, sem autorizar replay. O arquivo do objetivo original em .codex/attachments é privado e não está incluído no fork.

## Auditoria de três vias do runtime instalado (12/11/2026)

A fonte personalizada `codex-chatgpt-web@6.1.13` declara `bun@1.4.0`. Um build reproduzível em saída temporária, com a mesma versão de Bun, produziu hashes idênticos aos arquivos do runtime 6.1.13 instalado para `package.json`, `bun.lock`, `cli.js` e `browser-helper.cjs`. Os seis arquivos principais de `C:/Program Files/Codex Web GPT/resources/runtime` também correspondem byte a byte ao perfil `6.1.13-win32-x64`, incluindo manifesto, executável Bun e os artefatos do aplicativo.

O manifesto ativo declara `appVersion=6.1.13`, `bunVersion=1.4.0` e `bundleId=3c9d4c9b21fb1abb66acc46d484268bb9319bf2bd663fb5f7ccdd9a3a8614b9f`. A árvore de processos confirmou que o `bun.exe` filho do `Codex Web GPT.exe` em execução usa o perfil 6.1.13. O perfil 6.1.17 permanece armazenado, com hashes diferentes e sem processo ativo observado utilizando-o. O `resources/app.asar` instalado declara `codex-web-gpt-launcher@6.1.13`.

O fork declara `codex-continuos-infinity@6.1.18-continuos.1`. A alteração de teste que entrou no upstream `main` após a tag 6.1.18 já está presente em `launcher/tests/runtime-supervisor.test.cjs` no branch do Infinity. A fonte/runtime instalado 6.1.13 e o fork 6.1.18-continuos.1 foram comparados sem alterar a instalação de produção.
