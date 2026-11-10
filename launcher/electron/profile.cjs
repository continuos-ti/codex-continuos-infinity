const os = require("node:os");
const path = require("node:path");
const { PRODUCT_NAME, PRODUCTION_BROWSER_PARTITION, DEVELOPMENT_BROWSER_PARTITION } = require("./brand.cjs");

const PRODUCTION_PROFILE = "production";
const DEVELOPMENT_PROFILE = "development";

function resolveUserPath(value, homeDir = os.homedir()) {
  if (value === "~") return homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(homeDir, value.slice(2));
  }
  return path.resolve(value);
}

function resolveLauncherProfile({
  argv = process.argv,
  env = process.env,
  homeDir = os.homedir(),
  appData,
} = {}) {
  if (typeof appData !== "string" || !path.isAbsolute(appData)) {
    throw new Error("Launcher profile resolution requires an absolute appData path");
  }
  const development = argv.includes("--dev-profile");
  if (!development) {
    const coreHome = env.CODEX_CONTINUOS_INFINITY_HOME?.trim()
      ? resolveUserPath(env.CODEX_CONTINUOS_INFINITY_HOME.trim(), homeDir)
      : path.join(homeDir, ".codex-continuos-infinity");
    const userData = env.CODEX_CONTINUOS_INFINITY_DATA_DIR?.trim()
      ? resolveUserPath(env.CODEX_CONTINUOS_INFINITY_DATA_DIR.trim(), homeDir)
      : path.join(appData, PRODUCT_NAME);
    return {
      kind: PRODUCTION_PROFILE,
      displayName: PRODUCT_NAME,
      coreHome,
      codexHome: env.CODEX_HOME?.trim()
        ? resolveUserPath(env.CODEX_HOME.trim(), homeDir)
        : path.join(homeDir, ".codex"),
      userData,
      browserPartition: PRODUCTION_BROWSER_PARTITION,
    };
  }

  const coreHome = env.CODEX_CONTINUOS_INFINITY_DEV_HOME?.trim()
    ? resolveUserPath(env.CODEX_CONTINUOS_INFINITY_DEV_HOME.trim(), homeDir)
    : path.join(homeDir, ".codex-continuos-infinity-dev");
  const productionHome = env.CODEX_CONTINUOS_INFINITY_HOME?.trim()
    ? resolveUserPath(env.CODEX_CONTINUOS_INFINITY_HOME.trim(), homeDir)
    : path.join(homeDir, ".codex-continuos-infinity");
  if (path.resolve(coreHome) === path.resolve(productionHome)) {
    throw new Error("DEV profile home must differ from the production codex-chatgpt-web home");
  }
  return {
    kind: DEVELOPMENT_PROFILE,
    displayName: PRODUCT_NAME + " DEV",
    coreHome,
    codexHome: path.join(coreHome, "codex-home"),
    userData: path.join(coreHome, "launcher"),
    browserPartition: DEVELOPMENT_BROWSER_PARTITION,
  };
}

module.exports = {
  DEVELOPMENT_PROFILE,
  PRODUCTION_PROFILE,
  resolveLauncherProfile,
};
