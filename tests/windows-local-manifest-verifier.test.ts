import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { verifyWindowsLocalManifest } from "../scripts/verify-windows-local-manifest";

function fixture(run: (input: { integration: string; source: string; manifest: Record<string, unknown>;
  save: () => void }) => void): void {
  const root = mkdtempSync(join(tmpdir(), "infinity-manifest-test-"));
  const integration = join(root, "integrations", "windows-local");
  const source = join(root, "src", "index.ts");
  mkdirSync(integration, { recursive: true });
  mkdirSync(join(root, "src"));
  writeFileSync(source, "export const value = 1;\n");
  const sha256 = createHash("sha256").update("export const value = 1;\n").digest("hex");
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    files: [{ path: "../../src/index.ts", role: "bridge", packaged: false, sha256 }],
  };
  const save = () => writeFileSync(join(integration, "manifest.json"), JSON.stringify(manifest));
  try { save(); run({ integration, source, manifest, save }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("verifies a versioned Windows Local bridge manifest against its real source bytes", () => {
  fixture(({ integration }) => expect(verifyWindowsLocalManifest(integration)).toBe(1));
});

test("catches a changed bridge file even if its manifest still parses", () => {
  fixture(({ integration, source }) => {
    writeFileSync(source, "export const value = 2;\n");
    expect(() => verifyWindowsLocalManifest(integration)).toThrow("hash mismatch");
  });
});

test("refuses duplicate entries and paths outside the repository", () => {
  fixture(({ integration, manifest, save }) => {
    const entries = manifest.files as Record<string, unknown>[];
    manifest.files = [entries[0], { ...entries[0] }];
    save();
    expect(() => verifyWindowsLocalManifest(integration)).toThrow("unsafe or duplicate path");
    manifest.files = [{ ...entries[0], path: "../../../elsewhere" }];
    save();
    expect(() => verifyWindowsLocalManifest(integration)).toThrow("unsafe or duplicate path");
  });
});
