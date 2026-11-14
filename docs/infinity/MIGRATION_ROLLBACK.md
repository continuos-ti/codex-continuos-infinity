# Migração e rollback

O fork pode coexistir com o Codex Web GPT original. Uma compilação do Infinity não autoriza encerrar tarefas, substituir binários, reiniciar o gateway nem migrar credenciais sem validação.

## Preflight

1. Faça backup fora do GitHub de C:/Program Files/Codex Web GPT, APPDATA/Codex Web GPT, HOME/.codex-chatgpt-web e scripts de ProgramData/ContinuosIntegration.
2. Confirme que as tarefas e chamadas MCP terminaram antes de migrar serviços de inicialização.
3. Registre hashes, versão, configuração de portas e saúde do túnel. Preserve armazenamento autenticado sem publicar tokens ou cookies.
4. Execute o Infinity com perfil próprio e autenticação separada. Confirme ContinuosWebIntegracao, Cloudflare, Codex e seleção de GPT-6 quando disponível.
5. Migre apenas preferências não secretas. As preferências requeridas são conversas salvas, aprovação automática de ferramentas desativada, Bigger Context desativado, skills como arquivo desativadas e conversa obrigatoriamente nova por turno desativada.
6. Valide em staging 3 a 5 chats com anexos independentes e operação nativa longa. Os serviços só podem trocar de proprietário após drenagem das tarefas.
7. Desative processos de inicialização antigos apenas depois de confirmar que o novo estado está saudável. O checkpoint de reversão precisa ser testado.

## Rollback

Encerre somente o Infinity após verificar que ele não possui tarefas ativas, restaure o gerenciamento das portas e serviços a partir do backup validado e teste saúde do Codex Web GPT original, janela, proxy e autorização do conector. Mantenha os diagnósticos sanitizados em local privado para análise. Não misture bancos de sessão de versões diferentes.

O smoke unitário do instalador não prova migração nem rollback de sessões reais. Essa validação depende do ambiente autenticado e de uma janela sem trabalho ativo.

## Integração opcional do Windows Local

O contrato de identidade durável de `windows_command` e a persistência dos metadados de `screenshot_id` são instalados separadamente do Infinity. Execute `integrations/windows-local/apply-durable-command-jobs.ps1` para validar uma cópia temporária do código-fonte. O script usa dry-run por padrão. `-Apply` cria um backup com timestamp, instala o módulo Python e atualiza `windows_control.py`. Ele não reinicia o servidor.

Só aplique a integração depois que as chamadas Windows Local ativas terminarem. Em seguida, faça o reinício controlado do provedor e valide a revalidação de um `screenshot_id` recente, a expiração após 60 segundos, uma chamada longa, a consulta de `job_id` após reinício do servidor e a rejeição de uma época divergente. O resultado de `completed` comprova o código de saída do processo PowerShell acompanhado. Recursos alterados pelo comando ainda precisam de consulta própria.

Para reverter, execute o mesmo script com `-Rollback`. Ele restaura o `windows_control.py` e o módulo anteriores a partir do backup mais recente. O script também não reinicia o servidor durante o rollback.
