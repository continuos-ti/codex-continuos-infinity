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

O instalador Windows 6.1.18-continuos.1 foi recompilado em 10/11/2026 a partir do commit `64e784f`, com 153.677.159 bytes e SHA-256 `eff94f8b7fd6eedb685e8b4c722f6aa4732f87633a9d927066d173be9106dcbd`. O respectivo blockmap tem SHA-256 `4a4dd6b7393498d5fdd8f078128da2f6a531c860b740f01c754333204f7a103a`. `bun run verify` concluiu com exit code 0, incluindo 436 testes do launcher aprovados e 4 ignorados, e `7z t` aprovou o contêiner NSIS. O smoke isolado retornou `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. A aplicação em `C:/Program Files/Codex Web GPT` continua separada. Para testar a instalação NSIS real em um ambiente descartável, existe o comando explícito `bun run --cwd launcher smoke:package:installed`, que **altera a instalação per-user e o registro do Windows**; não o execute no computador produtivo.

O instalador não possui assinatura Authenticode. Uma release pública deve explicitar essa condição e fornecer checksums. Não altere as políticas de segurança do Windows para executar o pacote.

Em 11/11/2026, o instalador foi reconstruído após a validação de timestamps do cache de CWD confiável. O arquivo `codex-continuos-infinity-6.1.18-continuos.1-win-x64.exe` tem **153.677.385 bytes** e SHA-256 **`637b973d7b20b2620e1a311745bab43a4a5083f8b3f2fe65f602e5e3c76e4e11`**. O blockmap tem SHA-256 **`69d532f286b500989aac38cd9d1ad28efdf478f07b6a767ed78b50f52353c54f`**. `bun run app:smoke` confirmou `PACKAGED_LAUNCHER_PORTABLE_SMOKE_OK win32/x64`. A verificação integral `bun run verify` concluiu com exit code 0 e 436 testes do launcher aprovados, com quatro ignorados. Os 162 testes de `tests/environment.test.ts` passaram.

## Homologação

Compile e valide em staging. Faça login no navegador do Infinity, confirme o conector autorizado, modelos e permissões, e execute testes seguros de read-only antes de ativar qualquer rotina produtiva.
