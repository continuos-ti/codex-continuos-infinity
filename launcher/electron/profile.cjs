const os = require("node:os");
const fs = require("node:fs");
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

function canonicalProfilePath(value) {
  const absolute = path.resolve(value);
  let ancestor = absolute;
  for (;;) {
    try {
      const canonical = path.resolve(fs.realpathSync.native(ancestor), path.relative(ancestor, absolute));
      return process.platform === "win32" ? canonical.toLowerCase() : canonical;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error(`Cannot verify DEV launcher profile isolation: ${absolute}`, { cause: error });
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        throw new Error(`Cannot verify DEV launcher profile isolation: ${absolute}`, { cause: error });
      }
      ancestor = parent;
    }
  }
}

function profilesOverlap(first, second) {
  const inside = (candidate) => candidate === ""
    || (candidate !== ".." && !candidate.startsWith(`..${path.sep}`) && !path.isAbsolute(candidate));
  return inside(path.relative(first, second)) || inside(path.relative(second, first));
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

  const configuredDevHome = env.CODEX_CONTINUOS_INFINITY_DEV_HOME?.trim()
    || env.CODEX_WEB_GPT_DEV_HOME?.trim();
  const coreHome = configuredDevHome
    ? resolveUserPath(configuredDevHome, homeDir)
    : path.join(homeDir, ".codex-continuos-infinity-dev");
  const productionPaths = [
    path.join(homeDir, ".codex-continuos-infinity"),
    path.join(homeDir, ".codex-chatgpt-web"),
    path.join(homeDir, ".codex"),
    path.join(appData, PRODUCT_NAME),
    env.CODEX_CONTINUOS_INFINITY_HOME?.trim(),
    env.CODEX_CHATGPT_WEB_HOME?.trim(),
    env.CODEX_HOME?.trim(),
    env.CODEX_CONTINUOS_INFINITY_DATA_DIR?.trim(),
    env.CODEX_WEB_GPT_LAUNCHER_DATA_DIR?.trim(),
  ].filter(Boolean);
  const canonicalDevHome = canonicalProfilePath(coreHome);
  if (productionPaths.some(value => profilesOverlap(canonicalDevHome,
    canonicalProfilePath(resolveUserPath(value, homeDir))))) {
    throw new Error("DEV profile home must differ from the production and native Codex homes and launcher data");
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
