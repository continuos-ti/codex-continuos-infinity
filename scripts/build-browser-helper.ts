import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const output = resolve(process.argv[2] ?? join(root, ".launcher-runtime", "browser-helper.cjs"));
mkdirSync(dirname(output), { recursive: true });
const stagingDirectory = mkdtempSync(join(dirname(output), ".browser-helper-build-"));
try {
  const build = await Bun.build({
    entrypoints: [join(root, "src", "adapters", "chatgpt-web", "browser-helper-main.ts")],
    target: "node",
    format: "cjs",
    minify: true,
    packages: "external",
    external: ["playwright-core"],
    outdir: stagingDirectory,
    naming: basename(output),
  });
  if (!build.success) throw new Error(`Browser helper build failed: ${build.logs.map(log => log.message).join("; ")}`);
  const stagedOutput = join(stagingDirectory, basename(output));
  if (process.platform !== "win32") chmodSync(stagedOutput, 0o755);
  // Keep the previous helper valid until the complete new bundle is ready.
  renameSync(stagedOutput, output);
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true });
}
process.stdout.write(`${output}\n`);
