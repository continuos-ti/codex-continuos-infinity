const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveLauncherProfile } = require("../electron/profile.cjs");

test("DEV launcher profile isolates every durable home from production", () => {
  const homeDir = path.resolve("/Users/tester");
  const production = resolveLauncherProfile({
    argv: ["electron", "."],
    env: {},
    homeDir,
    appData: path.join(homeDir, "Library", "Application Support"),
  });
  const development = resolveLauncherProfile({
    argv: ["electron", ".", "--dev-profile"],
    env: {},
    homeDir,
    appData: path.join(homeDir, "Library", "Application Support"),
  });

  assert.equal(production.kind, "production");
  assert.equal(production.displayName, "Codex Continuos Infinity");
  assert.equal(path.basename(production.coreHome), ".codex-continuos-infinity");
  assert.equal(path.basename(production.userData), "Codex Continuos Infinity");
  assert.equal(development.kind, "development");
  assert.notEqual(development.coreHome, production.coreHome);
  assert.notEqual(development.codexHome, production.codexHome);
  assert.notEqual(development.userData, production.userData);
  assert.notEqual(development.browserPartition, production.browserPartition);
  assert.equal(development.userData, path.join(development.coreHome, "launcher"));
  assert.equal(development.codexHome, path.join(development.coreHome, "codex-home"));
});

test("DEV launcher refuses an explicit home collision with production", () => {
  const homeDir = path.resolve("/Users/tester");
  const shared = path.join(homeDir, "shared");
  assert.throws(() => resolveLauncherProfile({
    argv: ["electron", ".", "--dev-profile"],
    env: {
      CODEX_CONTINUOS_INFINITY_DEV_HOME: shared,
      CODEX_CONTINUOS_INFINITY_HOME: shared,
    },
    homeDir,
    appData: path.join(homeDir, "Library", "Application Support"),
  }), /must differ from the production/);
});

test("DEV launcher ignores generic production path overrides", () => {
  const homeDir = path.resolve("/Users/tester");
  const development = resolveLauncherProfile({
    argv: ["electron", ".", "--dev-profile"],
    env: {
      CODEX_CONTINUOS_INFINITY_HOME: path.join(homeDir, "production-core"),
      CODEX_HOME: path.join(homeDir, "production-codex"),
      CODEX_CONTINUOS_INFINITY_DATA_DIR: path.join(homeDir, "production-launcher"),
      CODEX_CONTINUOS_INFINITY_DEV_HOME: path.join(homeDir, "isolated-dev"),
    },
    homeDir,
    appData: path.join(homeDir, "Library", "Application Support"),
  });

  assert.equal(development.coreHome, path.join(homeDir, "isolated-dev"));
  assert.equal(development.codexHome, path.join(homeDir, "isolated-dev", "codex-home"));
  assert.equal(development.userData, path.join(homeDir, "isolated-dev", "launcher"));
});

test("DEV launcher honors the CLI development home override", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "continuos-launcher-override-"));
  try {
    const development = resolveLauncherProfile({
      argv: ["electron", ".", "--dev-profile"],
      env: { CODEX_WEB_GPT_DEV_HOME: path.join(root, "isolated") },
      homeDir: root,
      appData: path.join(root, "appdata"),
    });
    assert.equal(development.coreHome, path.join(root, "isolated"));
    assert.equal(development.userData, path.join(root, "isolated", "launcher"));
    assert.equal(development.codexHome, path.join(root, "isolated", "codex-home"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("DEV launcher rejects nested and aliased production homes and browser data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "continuos-launcher-collision-"));
  const production = path.join(root, "production");
  const alias = path.join(root, "alias");
  const appData = path.join(root, "appdata");
  try {
    fs.mkdirSync(production);
    fs.symlinkSync(production, alias, process.platform === "win32" ? "junction" : "dir");
    for (const devHome of [
      production,
      path.join(production, "nested"),
      root,
      alias,
      path.join(alias, "nested"),
      path.join(appData, "Codex Continuos Infinity"),
    ]) {
      assert.throws(() => resolveLauncherProfile({
        argv: ["electron", ".", "--dev-profile"],
        env: {
          CODEX_WEB_GPT_DEV_HOME: devHome,
          CODEX_CONTINUOS_INFINITY_HOME: production,
        },
        homeDir: root,
        appData,
      }), /DEV profile home must differ/);
    }
    for (const key of ["CODEX_HOME", "CODEX_CHATGPT_WEB_HOME", "CODEX_CONTINUOS_INFINITY_DATA_DIR", "CODEX_WEB_GPT_LAUNCHER_DATA_DIR"]) {
      assert.throws(() => resolveLauncherProfile({
        argv: ["electron", ".", "--dev-profile"],
        env: { CODEX_WEB_GPT_DEV_HOME: path.join(root, "custom-dev"), [key]: path.join(root, "custom-dev", "nested") },
        homeDir: root,
        appData,
      }), /DEV profile home must differ/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
