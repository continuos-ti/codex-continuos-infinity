import { expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  activateDevProfileEnvironment,
  devLauncherEnvironment,
  installedLauncherCandidates,
  readDevChatExperimentalFeatures,
  resolveDevProfilePaths,
} from "../src/dev-chat/profile";

test("DEV profile paths isolate browser, Codex, config, chat, and runtime state", () => {
  const homeDirectory = "/Users/tester";
  const devHome = resolve(homeDirectory, "development");
  const paths = resolveDevProfilePaths({
    homeDirectory,
    environment: {
      CODEX_CHATGPT_WEB_HOME: join(homeDirectory, "production"),
      CODEX_WEB_GPT_DEV_HOME: join(homeDirectory, "development"),
    },
  });
  expect(paths).toEqual({
    home: devHome,
    codexHome: join(devHome, "codex-home"),
    launcherUserData: join(devHome, "launcher"),
    launcherStatePath: join(devHome, "launcher", "launcher-state.json"),
    descriptorPath: join(devHome, "runtime", "launcher-browser.json"),
    chatsPath: join(devHome, "chats"),
    runtimePath: join(devHome, "runtime", "dev-chat"),
    configPath: join(devHome, "config.json"),
  });
});

test("Bigger Context is disabled by default and read from the isolated DEV runtime config", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-continuos-infinity-dev-features-"));
  try {
    const paths = resolveDevProfilePaths({
      homeDirectory: root,
      environment: { CODEX_WEB_GPT_DEV_HOME: join(root, "dev") },
    });
    expect(readDevChatExperimentalFeatures(paths)).toEqual({ biggerContext: false });
    mkdirSync(paths.home, { recursive: true });
    writeFileSync(paths.configPath, JSON.stringify({
      version: 3,
      experimentalBiggerContext: true,
    }));
    expect(readDevChatExperimentalFeatures(paths)).toEqual({ biggerContext: true });
    writeFileSync(paths.configPath, JSON.stringify({
      version: 3,
      experimentalBiggerContext: "yes",
    }));
    expect(() => readDevChatExperimentalFeatures(paths)).toThrow("Invalid Bigger Context preference");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DEV profile path refuses production home reuse", () => {
  const shared = "/Users/tester/shared";
  expect(() => resolveDevProfilePaths({
    homeDirectory: "/Users/tester",
    environment: {
      CODEX_CHATGPT_WEB_HOME: shared,
      CODEX_WEB_GPT_DEV_HOME: shared,
    },
  })).toThrow("must differ from the production");
});

test("DEV profile rejects legacy, native Codex, and namespaced production homes", () => {
  const root = mkdtempSync(join(tmpdir(), "continuos-dev-home-isolation-"));
  try {
    for (const protectedHome of [
      join(root, ".codex-chatgpt-web"),
      join(root, ".codex"),
      join(root, ".codex-continuos-infinity"),
      join(root, "custom-legacy"),
      join(root, "custom-infinity"),
      join(root, "custom-codex"),
      join(root, "custom-launcher"),
    ]) {
      expect(() => resolveDevProfilePaths({
        homeDirectory: root,
        environment: {
          CODEX_WEB_GPT_DEV_HOME: protectedHome,
          CODEX_CHATGPT_WEB_HOME: join(root, "custom-legacy"),
          CODEX_CONTINUOS_INFINITY_HOME: join(root, "custom-infinity"),
          CODEX_HOME: join(root, "custom-codex"),
          CODEX_CONTINUOS_INFINITY_DATA_DIR: join(root, "custom-launcher"),
        },
      })).toThrow("must differ from the production");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DEV profile rejects nested paths and junction aliases of production homes", () => {
  const root = mkdtempSync(join(tmpdir(), "continuos-dev-junction-isolation-"));
  const production = join(root, "production");
  const alias = join(root, "alias");
  try {
    mkdirSync(production);
    symlinkSync(production, alias, process.platform === "win32" ? "junction" : "dir");
    for (const devHome of [alias, join(alias, "nested"), join(production, "nested")]) {
      expect(() => resolveDevProfilePaths({
        homeDirectory: root,
        environment: { CODEX_WEB_GPT_DEV_HOME: devHome, CODEX_CHATGPT_WEB_HOME: production },
      })).toThrow("must differ from the production");
    }
    expect(() => resolveDevProfilePaths({
      homeDirectory: root,
      environment: { CODEX_WEB_GPT_DEV_HOME: root, CODEX_CHATGPT_WEB_HOME: production },
    })).toThrow("must differ from the production");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installed launcher discovery has explicit platform candidates", () => {
  expect(installedLauncherCandidates({
    platform: "darwin",
    homeDirectory: "/Users/tester",
    environment: {},
  })).toEqual([
    "/Applications/Codex Continuos Infinity.app/Contents/MacOS/Codex Continuos Infinity",
    "/Users/tester/Applications/Codex Continuos Infinity.app/Contents/MacOS/Codex Continuos Infinity",
  ]);
  expect(installedLauncherCandidates({
    platform: "linux",
    homeDirectory: "/home/tester",
    environment: { PATH: "/usr/local/bin:/usr/bin" },
  })).toEqual([
    "/home/tester/.local/bin/codex-continuos-infinity",
    "/usr/local/bin/codex-continuos-infinity",
    "/usr/bin/codex-continuos-infinity",
  ]);
  expect(installedLauncherCandidates({
    platform: "win32",
    homeDirectory: "C:\\Users\\tester",
    environment: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
  })).toEqual([
    "C:\\Users\\tester\\AppData\\Local\\Programs\\Codex Continuos Infinity\\Codex Continuos Infinity.exe",
  ]);
  expect(installedLauncherCandidates({
    platform: "win32",
    homeDirectory: "C:\\Users\\tester",
    environment: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
    windowsInstallLocation: "D:\\Apps\\Codex Continuos Infinity",
  })).toEqual([
    "D:\\Apps\\Codex Continuos Infinity\\Codex Continuos Infinity.exe",
  ]);
});

test("injected Windows discovery avoids the live registry while ordinary discovery still uses it", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const registry = spyOn(childProcess, "execFileSync").mockImplementation((() =>
    "    InstallLocation    REG_SZ    D:\\Installed\\Codex Continuos Infinity\n"
  ) as unknown as typeof childProcess.execFileSync);
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  try {
    expect(installedLauncherCandidates({
      platform: "win32",
      environment: { LOCALAPPDATA: "C:\\Fixture\\AppData\\Local" },
    })).toEqual(["C:\\Fixture\\AppData\\Local\\Programs\\Codex Continuos Infinity\\Codex Continuos Infinity.exe"]);
    expect(registry).not.toHaveBeenCalled();
    expect(installedLauncherCandidates({ platform: "win32", environment: process.env }))
      .toEqual(["D:\\Installed\\Codex Continuos Infinity\\Codex Continuos Infinity.exe"]);
    expect(registry).toHaveBeenCalledTimes(1);
    expect(installedLauncherCandidates({
      platform: "win32", environment: {}, windowsInstallLocation: "E:\\Explicit",
    })).toEqual(["E:\\Explicit\\Codex Continuos Infinity.exe"]);
    expect(registry).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(process, "platform", platform);
    registry.mockRestore();
  }
});

test("DEV launcher child cannot inherit production home or browser-profile overrides", () => {
  const paths = resolveDevProfilePaths({
    homeDirectory: "/Users/tester",
    environment: {
      CODEX_CHATGPT_WEB_HOME: "/Users/tester/production",
      CODEX_WEB_GPT_DEV_HOME: "/Users/tester/development",
    },
  });
  expect(devLauncherEnvironment(paths, {
    KEEP_ME: "yes",
    CODEX_CHATGPT_WEB_HOME: paths.home,
    CODEX_CONTINUOS_INFINITY_HOME: "/Users/tester/other-production",
    CODEX_CONTINUOS_INFINITY_DEV_HOME: "/Users/tester/other-development",
    CODEX_HOME: "/Users/tester/production-codex",
    CODEX_CHATGPT_WEB_TRUSTED_CODEX_HOMES: '["/Users/tester/second-account"]',
    CODEX_CONTINUOS_INFINITY_DATA_DIR: "/Users/tester/other-launcher",
    CODEX_WEB_GPT_LAUNCHER_DATA_DIR: "/Users/tester/production-launcher",
  })).toEqual({
    KEEP_ME: "yes",
    CODEX_WEB_GPT_DEV_HOME: paths.home,
  });
});

test("DEV chat activation removes shared production Codex and launcher homes", () => {
  const keys = ["CODEX_WEB_GPT_DEV_HOME", "CODEX_CHATGPT_WEB_HOME", "CODEX_CONTINUOS_INFINITY_HOME", "CODEX_CONTINUOS_INFINITY_DEV_HOME", "CODEX_HOME", "CODEX_CHATGPT_WEB_TRUSTED_CODEX_HOMES", "CODEX_CONTINUOS_INFINITY_DATA_DIR", "CODEX_WEB_GPT_LAUNCHER_DATA_DIR"];
  const saved = keys.map(key => process.env[key]);
  try {
    process.env.CODEX_CHATGPT_WEB_TRUSTED_CODEX_HOMES = '["/Users/tester/production-account"]';
    process.env.CODEX_CONTINUOS_INFINITY_HOME = "/Users/tester/production-infinity";
    process.env.CODEX_CONTINUOS_INFINITY_DATA_DIR = "/Users/tester/production-launcher";
    process.env.CODEX_CONTINUOS_INFINITY_DEV_HOME = "/Users/tester/another-dev";
    const paths = resolveDevProfilePaths({ environment: {}, homeDirectory: "/Users/tester" });
    activateDevProfileEnvironment(paths);
    expect(process.env.CODEX_CONTINUOS_INFINITY_HOME).toBe(paths.home);
    expect(process.env.CODEX_HOME).toBe(paths.codexHome);
    expect(process.env.CODEX_CHATGPT_WEB_TRUSTED_CODEX_HOMES).toBeUndefined();
    expect(process.env.CODEX_CONTINUOS_INFINITY_DATA_DIR).toBeUndefined();
    expect(process.env.CODEX_CONTINUOS_INFINITY_DEV_HOME).toBeUndefined();
  } finally {
    for (const [index, key] of keys.entries()) {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    }
  }
});
