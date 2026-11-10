# Supervisor por eventos — limites comprovados

O supervisor do Codex Continuos Infinity inicia a partir de eventos internos do runtime. Não utiliza cron, Task Scheduler ou automações ChatGPT para repetir comandos.

## Elegibilidade

A implementação atual de isSafeInBandAutoRepairFailure aceita chatgpt_stalled_same_turn ou chatgpt_response_incomplete apenas quando houve envio confirmado, o turno usa ferramentas locais, a conversa original está retida, não há cancelamento nem compaction e existem zero ferramentas MCP ativas. Nessa condição, a recuperação envia uma mensagem diagnóstica nova, identificando o trace, com limite de UMA tentativa.

O prompt original aceito nunca deve ser reenviado cegamente. Primeiro é obrigatório reconciliar chamadas mutáveis já aceitas e ler checkpoints e resultados. A execução de diagnóstico utiliza somente ferramentas com autorização atual. Tokens expirados não são reconstruídos.

## Falhas excluídas

Falhas de autenticação, aprovações manuais pendentes, CWD não comprovado, tarefas com ferramentas ativas e perda total do processo não têm autorização genérica de replay. Se o estado não puder ser provado, preservar o incidente e orientar a intervenção necessária. Retomada após crash total requer novo vínculo de sessão confiável.

## Evidências

Testes unitários do supervisor estão em tests/in-band-auto-repair.test.ts, tests/in-band-autorepair-runtime.test.ts e tests/in-band-autorepair-ipc.test.ts. A simulação tests/long-native-tool-polling-over90.test.ts verifica operação de longa duração sem repetição da chamada.

O trace real 863d5b00c1d4 em 10/11/2026 foi reconciliado por inspeção local. O supervisor aceitou uma mensagem de reparo e o trabalho prosseguiu sem reenviar a instrução original.

O incidente real `1865272fdf6f` tem reconciliação, causa comprovada do smoke e limitações de observação registradas em [INCIDENT_1865272fdf6f_20261110.md](INCIDENT_1865272fdf6f_20261110.md).

## Trabalho adicional para completar a missão

A implementação atual classifica automaticamente apenas os dois códigos de falha acima. Os demais códigos do objetivo, retomada automática após bloqueio de pré-envio missing cwd, falhas OAuth, crash de processo e homologação de 3 a 5 chats reais exigem cobertura adicional. Não confundir simulações com prova de restauração fim a fim.

## Preflight: falhas antes do envio (implementação atual)

O adaptador intercepta falhas de ambiente confiável em `environmentStore.resolve` **antes** de despachar o prompt ou registrar chamadas MCP. O supervisor classifica erros comprovados de CWD ausente, diretório removido, falta de política confiável e rollout nativo indisponível/ambíguo. Registra de forma durável um incidente local em `<home do Infinity>/diagnostics/preflight-incidents/<trace>.json`, com identificadores nativos (apenas UUIDs válidos), classificação, momento, checkpoint e estado de autorreparo; registra explicitamente `thisAttemptSubmitted=false`, `currentAttemptToolDispatches=0` e `autoRepairAttempts=0`. O estado de submissão de rodadas anteriores da mesma tarefa permanece marcado como `priorSubmissionState="unknown"` até consulta a checkpoints do turno original. O registro é de primeira gravação: uma repetição do mesmo trace não apaga sua evidência.

O journal não contém texto do prompt, caminhos do worktree, tokens OAuth/MCP, credenciais, detalhes de ferramenta ou mensagem livre de exceção. A gravação tem flush durável; uma falha de armazenamento não substitui o erro de autorização original. A implementação e os testes estão em `src/adapters/chatgpt-web/trusted-preflight-incident.ts`, `tests/trusted-preflight-incident.test.ts` e `tests/trusted-preflight-runtime.test.ts`.

Esse evento **não** autoriza tentar novamente o prompt nem adivinhar o diretório: após buscar a autoridade do rollout nativo atual, a execução continua bloqueada quando a origem do CWD ou as permissões permanecem desconhecidas. O incidente fornece uma fonte de reconciliação para futuros fluxos de retomada autenticados. Ainda faltam reparo autônomo de fonte nativa ausente, crash completo e validação de continuidade em produção.