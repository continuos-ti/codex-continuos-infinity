# Supervisor por eventos — limites comprovados

O supervisor do Codex Continuos Infinity inicia a partir de eventos internos do runtime. Não utiliza cron, Task Scheduler ou automações ChatGPT para repetir comandos.

## Elegibilidade

A implementação atual de isSafeInBandAutoRepairFailure aceita chatgpt_stalled_same_turn ou chatgpt_response_incomplete apenas quando houve envio confirmado, o turno usa ferramentas locais, a conversa original está retida, não há cancelamento nem compaction e existem zero ferramentas MCP ativas. Nessa condição, a recuperação envia uma mensagem diagnóstica nova, identificando o trace, com limite de UMA tentativa.

O prompt original aceito nunca deve ser reenviado cegamente. Primeiro é obrigatório reconciliar chamadas mutáveis já aceitas e ler checkpoints e resultados. A execução de diagnóstico utiliza somente ferramentas com autorização atual. Tokens expirados não são reconstruídos.

O pedido técnico de reparo usa somente o identificador sanitizado do incidente e o código validado da falha. O texto livre da exceção pode conter URLs, credenciais ou instruções não confiáveis; por isso ele não é incorporado ao prompt nem transportado pelo evento IPC `repair_prepare_requested`. Detalhes adicionais devem ser obtidos de diagnósticos locais autorizados e inspecionados separadamente. O teste `tests/in-band-auto-repair.test.ts` cobre vazamento de mensagem bruta, URL com token e instrução injetada, enquanto `tests/in-band-autorepair-ipc.test.ts` verifica o contrato de transporte.

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

## Incidentes duráveis do navegador (branch de desenvolvimento)

O runtime launcher registra eventos terminais de falha do navegador em `<config>/diagnostics/runtime-incidents/<trace>.json` antes de devolver o erro, inclusive perda de propriedade da aba antes da aquisição do lease, quando nenhum envio ocorreu. Cancelamentos explícitos antes do lease não geram incidente de falha. O evento só é registrado quando o adaptador fornece explicitamente um diretório de journal; testes isolados não gravam no perfil de produção. Após a tentativa de recuperação in-band, somente uma resposta concluída **e** a liberação confirmada da aba pelo launcher podem registrar `inband_response_completed`. Se a liberação indicar autenticação necessária, o registro representa falha.

Os registros são privados, limitados a categorias fixas e não sobrescrevíveis por outro processo. A gravação usa arquivo temporário sincronizado e publicação atômica com link exclusivo para evitar JSON parcial visível; o diretório também é sincronizado em Unix, enquanto Windows não oferece fsync portátil do diretório via Bun/Node. Um crash antes da publicação pode deixar um `.pending` privado órfão, que não deve ser confundido com registro final. Contêm trace, IDs nativos apenas se UUIDs válidos, fase (`before_send`, `send_activated`, `after_submission`), número observado de ferramentas ativas (ou `null`), resultado e tentativas de reparo. `send_activated` sem confirmação de envio é ambíguo; `priorSubmissionState` e `priorToolEffects` permanecem `unknown` mesmo quando não existem ferramentas ativas **agora**. Não armazenamos prompt, mensagem da exceção, CWD, URL, token, resposta nem identidade de chamada MCP não comprovada. A classificação genérica não autoriza replay de operações.

## Journal privado das chamadas MCP (branch de desenvolvimento)

O broker em modo `full` registra em `<home do Infinity>/diagnostics/broker-calls/<trace>/<hash>.json` eventos de primeira gravação para cada identidade de chamada: `queued` antes de colocar a chamada na fila, `delivery_possible` antes de oferecê-la ao adaptador, `result_received` antes de aceitar o retorno, `compaction_resolution_possible` antes de resolver internamente uma chamada enfileirada durante compactação e `retired_uncertain` antes de descartar chamadas pendentes na revogação. O hash é SHA-256 de `v1:<callId>:<evento>`; os registros conservam somente trace, identidade opaca da chamada, nome validado de ferramenta e momento. Argumentos, resultado, CWD e credenciais não são persistidos. Para trace externo sem ID nativo válido, um pseudônimo por registro protege o nome do diretório.

Esses eventos marcam **fronteiras de possibilidade**, não comprovam que a ação externa aconteceu nem permitem retomada ou novo despacho de uma ferramenta. Em particular, `result_received` registra que o broker observou o retorno, mas não conserva o corpo; `compaction_resolution_possible` não significa que o retorno interno chegou ao solicitante. No crash, a ausência de evento subsequente permanece ambígua. Uma falha de gravação antes de despachar ou resolver uma chamada interrompe a transição e preserva sua fila; na revogação, a falha de disco não pode impedir a liberação dos waiters. O journal é evidência para futura reconciliação com resultados autoritativos, não um mecanismo de replay ou uma implementação completa de retomada pós-crash.

Ao iniciar em modo `full`, o servidor também lê esse journal com `inspectBrokerCallJournal` e registra apenas contagens por estado: `queued_unconfirmed`, `delivery_unknown`, `result_unavailable`, `compaction_resolution_unavailable` e `retired_uncertain`. O leitor valida os identificadores, nomes de arquivo, hashes, transições e esquema de dados; ignora `.pending` ainda não publicado, rejeita evidências inconsistentes e limita o volume lido. Nenhum estado permite reaproveitar `turn_token`, reexecutar ferramenta ou afirmar que o resultado foi persistido. Se os registros estiverem corrompidos, o servidor registra a necessidade de revisão manual; a reconstrução de uma tarefa após crash ainda depende de uma fonte nativa de identidade e da reconciliação de efeitos externos. A inspeção não interrompe tarefas de outros turnos que o runtime ainda estiver executando.

Testes focados: `tests/broker-call-journal.test.ts`, cobrindo isolamento de conteúdo, gravação atômica, três turnos, reconexão com mesma identidade de chamada, falhas de gravação antes das transições, compactação e entrega por timer com falha de disco e nova tentativa. Os testes são simulações e não validam efeitos de ferramentas reais após encerramento do processo.

Os novos testes `tests/runtime-turn-incident.test.ts` e `tests/in-band-autorepair-runtime.test.ts` verificam gravação, proteção de dados, classificação, concorrência de registros por trace, falhas de autenticação, fronteira ambígua de envio e liberação final do launcher. Esses casos são simulados; testes reais de navegador, OAuth, ferramentas mutáveis e recuperação após crash ainda são necessários. Em especial, o journal **não comprova** reconciliação dos efeitos de ferramentas anteriores nem fornece retomada automática pós-crash por si só.
