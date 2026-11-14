import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");

test("runtime bundling leaves its output intact when Bun runs from that output", () => {
  const output = mkdtempSync(join(tmpdir(), "codex-infinity-bundle-protection-"));
  const bun = join(output, basename(process.execPath));
  const marker = join(output, "preserve-this-file.txt");
  try {
    copyFileSync(process.execPath, bun);
    chmodSync(bun, 0o755);
    writeFileSync(marker, "retained", "utf8");

    const child = spawnSync(bun, ["run", join(repositoryRoot, "scripts", "build-runtime-bundle.ts"), output], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 25_000,
    });

    expect(child.error).toBeUndefined();
    expect(child.status).not.toBe(0);
    expect(`${child.stdout ?? ""}\n${child.stderr ?? ""}`).toContain("running Bun executable is inside its output directory");
    expect(readFileSync(marker, "utf8")).toBe("retained");
    expect(existsSync(bun)).toBe(true);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
