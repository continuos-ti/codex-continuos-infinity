# CWD confiável no Codex

O diretório de trabalho é um atributo do contexto de execução confiável da tarefa. O adaptador não deve usar process.cwd(), home, texto do usuário ou diretório inferido como substituto para o campo cwd ausente.

A verificação principal está em src/adapters/chatgpt-web/environment.ts e thread-environment.ts. A recuperação utiliza codex-rollout-environment.ts e confronta thread_id, turn_id, workspace roots, sandbox e metadados de compaction com o registro nativo mais recente.

| Situação | Política |
| --- | --- |
| CWD atual validado e dentro da autorização | Aceitar |
| CWD omitido com rollout nativo atual comprovado | Reconstruir após validar IDs e permissões |
| CWD ausente sem prova atual | Rejeitar e registrar |
| Worktree removido, movido ou diferente | Revalidar disco e contexto nativo |
| Subagente e compaction | Conferir lineage e turno atual |
| Múltiplos CODEX_HOME | Associar ao registro nativo da tarefa, sem suposição |
| Estado persistido expirado ou corrompido | Rejeitar reutilização como autoridade |

Os testes relevantes estão em tests/environment.test.ts, tests/trusted-codex-homes.test.ts e tests/subagent-environment-history.test.ts. A lógica atual herdada do upstream 6.1.18 verifica contexto e registros, porém o supervisor ainda precisa integrar um fluxo de recuperação seguro pré-envio para todas as origens do erro missing cwd.

## Verificações nativas de diretório (10/11/2026)

O preflight do runtime agora consulta o diretório de trabalho no sistema de arquivos **antes** de disponibilizar o ambiente ao broker. Em particular:

- O `cwd` recuperado do `turn_context` do rollout nativo deve existir e ser um diretório acessível; a validação ocorre após a checagem de identidade de thread/turno. Uma pasta movida ou removida bloqueia a execução em vez de receber um substituto inferido.
- O `cwd` de um envelope de ambiente atual também deve existir; se ele estiver ausente, a recuperação só poderá prosseguir com o rollout nativo correspondente. Caso não haja prova, permanece bloqueada antes do envio ao ChatGPT.
- Um registro persistido da mesma thread não reautoriza diretórios inexistentes. Em particular, para pares de IDs nativos UUID de thread e turno, a ausência da comprovação do **rollout atual** não permite recorrer silenciosamente à permissão salva de outra rodada.
- Para os modos restritos (`read-only` e `workspace-write`), o preflight compara os destinos reais (`realpath`) do `cwd` e da raiz autorizada. Isso bloqueia um link simbólico/junction lexicalmente dentro do workspace que redirecione a outro diretório. A checagem ocorre também ao reutilizar o cache e na entrada do broker remoto; roots inválidas ou inacessíveis não geram permissões novas. Full Access continua permitindo worktrees externas quando o rollout nativo atual as comprova.
- Dados de ferramentas continuam a vir da solicitação atual; o cache não persiste inventário MCP, tokens nem credenciais.

Os testes de regressão em `tests/environment.test.ts` cobrem CWD de rollout removido após uma resolução válida, envelope atual com pasta removida, cache histórico para pasta eliminada e thread/turno nativos sem rollout correspondente. Os testes usam diretórios temporários ou caminhos inexistentes, sem remover worktrees reais.

O cache de ambiente expira após 30 dias. Na leitura, timestamps negativos, não finitos ou mais de cinco minutos à frente do relógio atual invalidam o registro persistido, preservando o arquivo para diagnóstico. Após um recuo do relógio em uma instância já iniciada, a reutilização em memória também é interrompida quando excede essa tolerância. Dois testes adicionais cobrem a validação da persistência e o recuo do relógio.

**Limites:** `stat`/`realpath` verificam disponibilidade e destino no instante do preflight, não oferecem reserva exclusiva de uma árvore de diretórios; a mudança do caminho após a validação continua sendo uma condição de corrida sujeita ao sandbox nativo. O fluxo ainda não reconstrói automaticamente tarefas quando a sessão nativa inteira desaparece; erros sem autoridade suficiente exigem reparo de origem e não reenvio do prompt. As demais classes de erro e homologações externas do supervisor permanecem pendentes.

O erro de preflight também produz um incidente local privado, identificado por trace, conforme [SUPERVISOR.md](SUPERVISOR.md). O registro comprova apenas que **a tentativa atual** foi bloqueada antes de enviar o prompt ou despachar uma ferramenta; para tentativas anteriores da mesma tarefa, o estado de envio permanece desconhecido até reconciliação.

Se um turno tiver identificadores nativos UUID de thread e turno, e o primeiro preflight encontrar somente ausência temporária de autoridade de CWD, permissão ou rollout, o adaptador aguarda 150 ms e depois 300 ms para consultar novamente a mesma fonte nativa. Cada tentativa repete todas as verificações de identidade, roots, sandbox e existência do diretório. A recuperação ocorre antes de qualquer envio ao navegador. Diretórios removidos, políticas conflitantes, proprietários ambíguos, IDs não nativos e erros inesperados são rejeitados imediatamente. Após duas tentativas adicionais sem comprovação, o incidente original é registrado e o turno é bloqueado. Cancelamento interrompe a espera. Uma recuperação bem-sucedida registra somente trace e quantidade de tentativas no log sanitizado.
