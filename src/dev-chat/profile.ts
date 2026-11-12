import { execFileSync, spawn } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";
import { expandUserPath, getConfigPath } from "../config";
import {
  readLauncherBrowserHostDescriptor,
  type LauncherBrowserHostDescriptor,
} from "../launcher-browser-host";

import { DEV_LAUNCHER_PROFILE } from "./constants";

export interface DevProfilePaths {
  home: string;
  codexHome: string;
  launcherUserData: string;
  launcherStatePath: string;
  descriptorPath: string;
  chatsPath: string;
  runtimePath: string;
  configPath: string;
}

const WINDOWS_LAUNCHER_GUID = "8d70288c-48e8-55c9-94ad-16f56e4d0a88";

/** Resolve existing path aliases, including junctions, before checking DEV isolation. */
function isolationPath(value: string): string {
  const absolute = resolve(expandUserPath(value));
  let ancestor = absolute;
  while (true) {
    try {
      const canonical = resolve(realpathSync.native(ancestor), relative(ancestor, absolute));
      return process.platform === "win32" ? canonical.toLowerCase() : canonical;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`Cannot verify DEV profile path isolation: ${absolute}`, { cause: error });
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) {
        throw new Error(`Cannot verify DEV profile path isolation: ${absolute}`, { cause: error });
      }
      ancestor = parent;
    }
  }
}

function overlappingProfilePaths(first: string, second: string): boolean {
  const inside = (candidate: string): boolean =>
    candidate === "" || (candidate !== ".." && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate));
  return inside(relative(first, second)) || inside(relative(second, first));
}

function registeredWindowsLauncherInstallLocation(): string | undefined {
  try {
    const output = execFileSync(
      "reg.exe",
      ["query", `HKCU\\Software\\${WINDOWS_LAUNCHER_GUID}`, "/v", "InstallLocation"],
      { encoding: "utf8", windowsHide: true },
    );
    const match = output.match(/^\s*InstallLocation\s+REG_SZ\s+(.+?)\s*$/mi);
    return match && win32.isAbsolute(match[1]) ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

export function resolveDevProfilePaths({
  environment = process.env,
  homeDirectory = homedir(),
}: {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
} = {}): DevProfilePaths {
  const home = resolve(expandUserPath(
    environment.CODEX_CONTINUOS_INFINITY_DEV_HOME?.trim() || environment.CODEX_WEB_GPT_DEV_HOME?.trim() || join(homeDirectory, ".codex-continuos-infinity-dev"),
  ));
  const protectedHomes = [
    join(homeDirectory, ".codex-continuos-infinity"),
    join(homeDirectory, ".codex-chatgpt-web"),
    join(homeDirectory, ".codex"),
    environment.CODEX_CONTINUOS_INFINITY_HOME?.trim(),
    environment.CODEX_CHATGPT_WEB_HOME?.trim(),
    environment.CODEX_HOME?.trim(),
  ].filter((value): value is string => Boolean(value));
  const canonicalDevHome = isolationPath(home);
  if (protectedHomes.some(productionHome => overlappingProfilePaths(canonicalDevHome, isolationPath(productionHome)))) {
    throw new Error("DEV profile home must differ from the production profile and Codex homes");
  }
  const launcherUserData = join(home, "launcher");
  return {
    home,
    codexHome: join(home, "codex-home"),
    launcherUserData,
    launcherStatePath: join(launcherUserData, "launcher-state.json"),
    descriptorPath: join(home, "runtime", "launcher-browser.json"),
    chatsPath: join(home, "chats"),
    runtimePath: join(home, "runtime", "dev-chat"),
    configPath: join(home, "config.json"),
  };
}

export interface DevChatExperimentalFeatures {
  biggerContext: boolean;
}

/** Read the canonical DEV runtime setting consumed by repository chat commands. */
export function readDevChatExperimentalFeatures(
  paths = resolveDevProfilePaths(),
): DevChatExperimentalFeatures {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(paths.configPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { biggerContext: false };
    throw new Error(
      `Could not read DEV runtime settings from ${paths.configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as { version?: unknown }).version !== 3) {
    throw new Error(`Invalid DEV runtime settings in ${paths.configPath}`);
  }
  const enabled = (value as { experimentalBiggerContext?: unknown }).experimentalBiggerContext;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new Error(`Invalid Bigger Context preference in ${paths.configPath}`);
  }
  return { biggerContext: enabled === true };
}

export function activateDevProfileEnvironment(paths = resolveDevProfilePaths()): DevProfilePaths {
  process.env.CODEX_WEB_GPT_DEV_HOME = paths.home;
  process.env.CODEX_CHATGPT_WEB_HOME = paths.home;
  process.env.CODEX_CONTINUOS_INFINITY_HOME = paths.home;
  process.env.CODEX_HOME = paths.codexHome;
  delete process.env.CODEX_CHATGPT_WEB_TRUSTED_CODEX_HOMES;
  if (getConfigPath() !== paths.configPath) {
    throw new Error("DEV profile environment did not resolve to its isolated configuration path");
  }
  return paths;
}

function executableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && (process.platform === "win32" || (stat.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

export function installedLauncherCandidates({
  environment = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
  windowsInstallLocation,
}: {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  windowsInstallLocation?: string;
} = {}): string[] {
  const override = environment.CODEX_CONTINUOS_INFINITY_LAUNCHER_EXECUTABLE?.trim();
  const candidates = override ? [expandUserPath(override)] : [];
  const targetPath = platform === "win32" ? win32 : posix;
  if (platform === "darwin") {
    candidates.push(
      "/Applications/Codex Continuos Infinity.app/Contents/MacOS/Codex Continuos Infinity",
      posix.join(homeDirectory, "Applications", "Codex Continuos Infinity.app", "Contents", "MacOS", "Codex Continuos Infinity"),
    );
  } else if (platform === "win32") {
    const registeredLocation = windowsInstallLocation?.trim()
      || (process.platform === "win32" && environment === process.env
        ? registeredWindowsLauncherInstallLocation() : undefined);
    if (registeredLocation && win32.isAbsolute(registeredLocation)) {
      candidates.push(win32.join(registeredLocation, "Codex Continuos Infinity.exe"));
    } else {
      const localAppData = environment.LOCALAPPDATA?.trim();
      if (localAppData) {
        candidates.push(win32.join(localAppData, "Programs", "Codex Continuos Infinity", "Codex Continuos Infinity.exe"));
      }
    }
  } else if (platform === "linux") {
    candidates.push(posix.join(homeDirectory, ".local", "bin", "codex-continuos-infinity"));
    for (const entry of (environment.PATH || "").split(":").filter(Boolean)) {
      candidates.push(posix.join(entry, "codex-continuos-infinity"));
    }
  }
  return [...new Set(candidates.map(candidate => targetPath.resolve(candidate)))];
}

export function findInstalledLauncherExecutable(options: Parameters<typeof installedLauncherCandidates>[0] = {}): string {
  const candidates = installedLauncherCandidates(options);
  const executable = candidates.find(executableFile);
  if (executable) return executable;
  throw new Error(
    "Installed Codex Continuos Infinity launcher was not found. Install it first or set CODEX_CONTINUOS_INFINITY_LAUNCHER_EXECUTABLE to its absolute executable path."
      + ` Checked: ${candidates.join(", ") || "no platform candidates"}`,
  );
}

export function devLauncherEnvironment(
  paths: DevProfilePaths,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const childEnvironment = { ...environment };
  delete childEnvironment.CODEX_CHATGPT_WEB_HOME;
  delete childEnvironment.CODEX_CONTINUOS_INFINITY_HOME;
  delete childEnvironment.CODEX_CONTINUOS_INFINITY_DEV_HOME;
  delete childEnvironment.CODEX_HOME;
  delete childEnvironment.CODEX_CHATGPT_WEB_TRUSTED_CODEX_HOMES;
  delete childEnvironment.CODEX_WEB_GPT_LAUNCHER_DATA_DIR;
  childEnvironment.CODEX_WEB_GPT_DEV_HOME = paths.home;
  return childEnvironment;
}

function devDescriptor(path: string): LauncherBrowserHostDescriptor {
  const descriptor = readLauncherBrowserHostDescriptor(path);
  if (descriptor.profile !== DEV_LAUNCHER_PROFILE) {
    throw new Error(`Launcher descriptor belongs to ${descriptor.profile}, not the isolated DEV profile`);
  }
  return descriptor;
}

export async function waitForDevLauncher(
  descriptorPath: string,
  timeoutMs = 30_000,
): Promise<LauncherBrowserHostDescriptor> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "descriptor is not ready";
  while (Date.now() < deadline) {
    try {
      return devDescriptor(descriptorPath);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error(`DEV launcher did not become ready within ${timeoutMs}ms: ${lastError}`);
}

export async function launchDevProfile(
  paths = resolveDevProfilePaths(),
  options: { executable?: string; timeoutMs?: number } = {},
): Promise<{ descriptor: LauncherBrowserHostDescriptor; executable: string; alreadyRunning: boolean }> {
  let existing: LauncherBrowserHostDescriptor | undefined;
  try { existing = devDescriptor(paths.descriptorPath); }
  catch { /* A stale or absent descriptor is replaced only by its owning launcher. */ }

  const executable = options.executable ? resolve(options.executable) : findInstalledLauncherExecutable();
  if (!isAbsolute(executable) || !executableFile(executable)) {
    throw new Error(`DEV launcher executable is not an executable regular file: ${executable}`);
  }
  const child = spawn(executable, ["--dev-profile"], {
    detached: true,
    env: devLauncherEnvironment(paths),
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  const descriptor = await waitForDevLauncher(paths.descriptorPath, options.timeoutMs);
  return { descriptor, executable, alreadyRunning: existing?.pid === descriptor.pid };
}
