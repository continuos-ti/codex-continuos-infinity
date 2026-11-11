import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test("DEV helper build replaces a previous bundle with the current Infinity browser partition", () => {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const directory = mkdtempSync(join(tmpdir(), "infinity-dev-helper-"));
  const target = join(directory, "browser-helper.cjs");
  writeFileSync(target, "PREVIOUS_VALID_HELPER");

  try {
    const build = Bun.spawnSync([
      process.execPath, "run", join(projectRoot, "scripts", "build-browser-helper.ts"), target,
    ], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });

    expect(build.exitCode).toBe(0);
    const bundle = readFileSync(target, "utf8");
    expect(bundle).not.toContain("PREVIOUS_VALID_HELPER");
    expect(bundle).toContain("persist:codex-continuos-infinity-dev-chatgpt");
    expect(bundle).not.toContain("persist:codex-web-gpt-dev-chatgpt");
    expect(readdirSync(directory)).toEqual(["browser-helper.cjs"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("DEV helper build failure leaves the previous bundle intact and removes staging files", () => {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const directory = mkdtempSync(join(tmpdir(), "infinity-dev-helper-failure-"));
  const target = join(directory, "browser-helper.cjs");
  const scriptsDirectory = join(directory, "scripts");
  const sourceDirectory = join(directory, "src", "adapters", "chatgpt-web");
  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(sourceDirectory, { recursive: true });
  copyFileSync(join(projectRoot, "scripts", "build-browser-helper.ts"), join(scriptsDirectory, "build-browser-helper.ts"));
  writeFileSync(join(sourceDirectory, "browser-helper-main.ts"), "export const incomplete = ;\n");
  writeFileSync(target, "PREVIOUS_VALID_HELPER");

  try {
    const build = Bun.spawnSync([
      process.execPath, "run", join(scriptsDirectory, "build-browser-helper.ts"), target,
    ], { cwd: directory, stdout: "pipe", stderr: "pipe" });

    expect(build.exitCode).not.toBe(0);
    expect(readFileSync(target, "utf8")).toBe("PREVIOUS_VALID_HELPER");
    expect(readdirSync(directory).filter(name => name.startsWith(".browser-helper-build-"))).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
