# Instalação e build

## Compilar

Requisitos: Windows 11 x64, Git, Node.js recente, Bun 1.4.0 e dependências Electron. No diretório do fork:

1. bun install
2. cd launcher && bun install && cd ..
3. bun run typecheck
4. bun test ./tests
5. bun run launcher:build
6. bun run --cwd launcher package:win

O executável Windows fica em launcher/artifacts/codex-continuos-infinity-<version>-win-x64.exe. O binário usa appId br.com.continuos.codexinfinity.launcher e GUID NSIS 8d70288c-48e8-55c9-94ad-16f56e4d0a88.

Para reconstruir o instalador no Windows, execute Bun 1.4.0 a partir de um diretório externo a `launcher/build/runtime`. O empacotamento recria essa pasta e o Windows impede remover um executável em uso.

O launcher usa APPDATA/Codex Continuos Infinity e HOME/.codex-continuos-infinity. É independente de C:/Program Files/Codex Web GPT e do perfil HOME/.codex-chatgpt-web em produção.

## Releases e verificações

A pipeline .github/workflows/release.yml usa tags de versão do fork. Os scripts scripts/install-launcher.ps1, install-launcher.sh e install.sh buscam releases do repositório continuos-ti/codex-continuos-infinity e verificam SHA-256 pelos checksums publicados. O cliente de atualização consulta apenas releases do fork.

Variáveis de configuração: CODEX_CONTINUOS_INFINITY_HOME, CODEX_CONTINUOS_INFINITY_DATA_DIR, CODEX_CONTINUOS_INFINITY_DEV_HOME, CODEX_CONTINUOS_INFINITY_REPOSITORY e CODEX_CONTINUOS_INFINITY_VERSION. O runtime conserva CODEX_CHATGPT_WEB_HOME como variável interna de compatibilidade.

## Verificação local

O empacotamento gera `launcher/artifacts/checksums-local.txt` com SHA-256 do instalador e dos respectivos blockmaps/arquivos distribuíveis. O comando `bun run app:smoke` valida a lista completa e os hashes antes de extrair o payload NSIS com 7-Zip em uma pasta temporária, executar o launcher empacotado no modo smoke com perfis isolados e verificar o manifesto do runtime e seu `bundleId`. No Windows, **não executa o instalador, não altera o registro e não substitui o launcher instalado**. Requer 7-Zip (`SEVEN_ZIP_EXE` pode apontar ao executável). A extração é removida ao terminar. Qualquer alteração do instalador exige reconstrução dos hashes; não reutilize hashes de compilações anteriores.

O instalador Windows 6.1.18-continuos.1 foi recompilado em 10/11/2026, com 153.675.718 bytes e SHA-256 `c20ec506c6733605b8807dae454fdc3de2bb0806c578e5814a4ec390767213c8`. A inspeção do contêiner NSIS via `7z t` foi aprovada, e o smoke isolado retornou `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. A aplicação em `C:/Program Files/Codex Web GPT` continua separada. Para testar a instalação NSIS real em um ambiente descartável, existe o comando explícito `bun run --cwd launcher smoke:package:installed`, que **altera a instalação per-user e o registro do Windows**; não o execute no computador produtivo.

O instalador não possui assinatura Authenticode. Uma release pública deve explicitar essa condição e fornecer checksums. Não altere as políticas de segurança do Windows para executar o pacote.

## Homologação

Compile e valide em staging. Faça login no navegador do Infinity, confirme o conector autorizado, modelos e permissões, e execute testes seguros de read-only antes de ativar qualquer rotina produtiva.
