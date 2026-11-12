# Auditoria do upstream

## Revalidação do upstream — 12/11/2026

A consulta autenticada ao GitHub confirmou `v6.1.18` como release mais recente e `f08d16509e6a5447a0d0f2943abb172c69705160` como `main` upstream mais recente (commit de 12/11/2026, filho de `3b41eda2efa731245d171b51dbd30935e587c937`). O commit incorpora a correção do menu Radix de effort e a captura do estado do slider aberto durante a inspeção de capacidades.

A branch isolada `integration/upstream-f08d165-20261112` registra o merge `fb1818c7470b64855a68b71238d43e25baae280a`; o merge `b25e1458b10bc86681b6525db722f26e36a33833` incorpora essa integração em `feature/continuos-infinity-native`. A verificação local de ancestralidade confirmou `upstream/main` como ancestral do HEAD, sem commits upstream pendentes de integração. O fork continua relacionado ao parent original, e o PR #1 aponta exclusivamente para `main` de `continuos-ti/codex-continuos-infinity`, em draft. Nenhum commit foi enviado ao repositório `miuuyy/codex-chatgpt-web`.


Em 12/11/2026, a tag oficial `v6.1.18` aponta para `1cc49aaa627a995d3f0cf2f971fde7f764996649`. O `main` do fork foi criado a partir de `32fd3436eb6ed94898b987a3c369003bb6fb8d54`. A consulta posterior ao GitHub confirmou que o `main` upstream avançou para `3b41eda2efa731245d171b51dbd30935e587c937`. Os nove commits entre essas referências foram integrados à branch do Infinity pelo merge `3ed1c0aa7d524f0b690c21f84ac3835d9bdca9a3`, preservando como pais o histórico personalizado `7504352999f94b8b7aac0371b56d6f2328ee1c66` e o upstream `3b41eda2efa731245d171b51dbd30935e587c937`. A fonte personalizada e o runtime ativo permanecem na versão 6.1.13. A tag oficial 6.1.13 é `6f43747`. O fork `continuos-ti/codex-continuos-infinity` preserva sua relação com o parent no GitHub.

## Integração controlada do upstream (12/11/2026)

O compare oficial `32fd3436...3b41eda2` confirmou nove commits upstream. Foram integradas correções para idioma do navegador incorporado e seu ciclo de reinicialização, reset dos dados da sessão incorporada, listas de subagentes com UUID, shells remountados do preview Mermaid e substituição de drafts restaurados ao anexar prompts. A integração foi feita sem conflitos automáticos e registrada no merge `3ed1c0a`. O commit de documentação `7c8a76ce30dad296cca6fd345784040beeb9212a` atualiza a matriz de aceite e mantém a PR #1 em draft, apontando para `main` do fork.

Na validação local de 12/11, os testes direcionados de journal/reconciliação, identidade de operação, autorreparo in-band e CWD confiável terminaram com **242 aprovados, zero falhas e 1.224 verificações** em sete arquivos. A integração Windows Local passou em **21 testes Python**, e o instalador executou o dry-run contra `H:\Projetos\windows-local` sem modificar a fonte ou os processos ativos. Esses testes exercitam contratos e cópias isoladas. Não comprovam OAuth/PKCE completo no harness DEV, efeitos externos de ferramentas após crash ou retomada com novo vínculo nativo.

## DEV Full com transporte external-cloudflare (12/11/2026)

- **Comportamento anterior** — `dev setup` aceitava `external-cloudflare`, mas `dev status` e `dev chat` consultavam `tunnelStatus` e exigiam credenciais de túnel local.
- **Problema** — um perfil DEV Full configurado para o gateway Cloudflare não conseguia reportar prontidão nem iniciar seu broker isolado.
- **Componentes** — `src/doctor.ts`, `src/dev-chat/cli.ts`, `src/dev-chat/transport.ts`, `src/setup.ts`, `tests/doctor-external-gateway.test.ts` e `tests/dev-chat.test.ts`.
- **Implementação** — `inspectExternalGatewayHealth` centraliza o timeout, a resposta HTTP e a identidade esperada do serviço. Doctor, status e transporte DEV usam a mesma verificação. O transporte DEV aceita Cloudflare externo e mantém o broker local isolado.
- **Equivalência upstream** — não há implementação equivalente no upstream. É uma extensão do harness do fork.
- **Dependências e riscos** — depende do endpoint de saúde configurado e do campo `expectedService`. A prontidão confirma a saúde do gateway, sem provar OAuth/PKCE nem a execução de ferramentas MCP. As ferramentas do `dev chat` continuam simuladas.
- **Aceite** — três testes unitários cobrem sucesso, HTTP 401 e identidade divergente. Um teste cobre a criação do broker DEV sem túnel local. A consulta ao endpoint real configurado retornou `ready=true`.

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

## Isolamento obrigatório do gateway DEV (12/11/2026)

A auditoria de recursos Cloudflare confirmou que `codex-native2.continuos.com.br` pertence ao túnel compartilhado `windows-local-mcp`, cujo ingresso envia o tráfego a `http://127.0.0.1:28765`. O processo local nessa porta executa `codex_cf_oauth.py`, o gateway OAuth/MCP de produção que importa o catálogo e o dispatcher `codex_cf_gateway_lab`. O perfil DEV Full estava configurado para consultar esse mesmo hostname. A existência de um perfil/browser home separado não torna isolado um endpoint MCP compartilhado; autorizar o conector DEV ali permitiria que ele alcançasse o mesmo provedor e as mesmas ferramentas de produção. A listagem de túneis não encontrou um túnel dedicado ao Infinity DEV.

Foi acrescentada uma barreira fail-closed: `validateIsolatedDevExternalGateway` rejeita o origin de produção e exige que MCP e health compartilhem um origin DEV dedicado. `setupDevProfile`, `dev status`, `dev chat` e o doctor do launcher aplicam a mesma regra; o CLI exige os três parâmetros explícitos para o gateway DEV. A configuração existente que aponta para produção passa a ser considerada **não pronta** e não deve ser autorizada nem usada para chamadas de ferramenta. Os testes dirigidos cobrem rejeição antes de probe, criação de broker ou gravação da configuração, além de sucesso e health negativo para um host DEV distinto. A infraestrutura Cloudflare de produção não foi alterada. Continua pendente provisionar um gateway/túnel DEV com estado OAuth e dispatcher de ferramentas de teste próprios.
