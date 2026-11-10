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
