# Exemplo de preferências não secretas

Este documento demonstra opções de preferência. A configuração real deve ser criada pelo setup, pois inclui caminhos, identidade e campos protegidos.

    {
      "version": 3,
      "releaseVersion": "6.1.18-continuos.1",
      "appName": "ContinuosWebIntegracao",
      "mode": "full",
      "browserInteractionMode": "automatic",
      "mcpTransport": "external-cloudflare",
      "externalGateway": {
        "mcpUrl": "https://codex-native2.continuos.com.br/mcp",
        "healthUrl": "https://codex-native2.continuos.com.br/health",
        "expectedService": "ContinuosWebIntegracao"
      },
      "host": "127.0.0.1",
      "port": 17841,
      "useTemporaryChats": false,
      "autoApproveToolCalls": false,
      "experimentalBiggerContext": false,
      "experimentalSkillAttachments": false,
      "experimentalFreshConversationPerTurn": false
    }

Os campos acima podem não constituir configuração operacional completa. Não copie o exemplo sobre configurações existentes nem incorpore tokens, credenciais ou perfis autenticados ao repositório público.

`mcpTransport` aceita `external-cloudflare` (gateway OAuth externo, modo Automatic) ou `openai-tunnel` (túnel gerenciado pelo runtime). O setup gera e valida a configuração operacional. O exemplo Cloudflare identifica apenas endpoints públicos e a identidade esperada do serviço, sem representar autorização OAuth já concluída.

No modo Zero Risk, o transporte ativo permanece `openai-tunnel`. A configuração `externalGateway` pode ser mantida como preferência para o próximo retorno explícito ao Automatic. No modo `browser-only`, `mcpTransport` e `externalGateway` não são permitidos.
