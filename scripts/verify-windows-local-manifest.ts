import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const defaultIntegrationRoot = join(projectRoot, "integrations", "windows-local");

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(".." + requireSeparator()) && rel !== ".." && !isAbsolute(rel));
}

function requireSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

/** Fail before a build if the staged bridge does not match its reviewed source manifest. */
export function verifyWindowsLocalManifest(integrationRoot = defaultIntegrationRoot): number {
  const root = resolve(integrationRoot, "..", "..");
  const manifestPath = join(integrationRoot, "manifest.json");
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Windows Local integration manifest must be an object");
  }
  const value = manifest as Record<string, unknown>;
  if (value.schemaVersion !== 1 || !Array.isArray(value.files) || value.files.length === 0 || value.files.length > 128) {
    throw new Error("Windows Local integration manifest has an invalid schema or file count");
  }
  const seen = new Set<string>();
  const canonicalRoot = realpathSync(root);
  for (const item of value.files) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Windows Local integration manifest contains a malformed entry");
    }
    const entry = item as Record<string, unknown>;
    const path = entry.path;
    if (typeof path !== "string" || path.length === 0 || path.length > 512
      || isAbsolute(path) || /^([A-Za-z]:|\\\\)/.test(path) || path.includes("\\")) {
      throw new Error("Windows Local integration manifest has an invalid source path");
    }
    const source = resolve(integrationRoot, path);
    if (!inside(root, source) || seen.has(source) || !inside(canonicalRoot, realpathSync(source))) {
      throw new Error(`Windows Local integration manifest contains an unsafe or duplicate path: ${path}`);
    }
    seen.add(source);
    if (!lstatSync(source).isFile() || typeof entry.role !== "string" || entry.role.length === 0
      || typeof entry.packaged !== "boolean" || typeof entry.sha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`Windows Local integration manifest has invalid file metadata: ${path}`);
    }
    const actual = createHash("sha256").update(readFileSync(source)).digest("hex");
    if (actual !== entry.sha256) {
      throw new Error(`Windows Local integration manifest hash mismatch: ${path}`);
    }
  }
  return seen.size;
}

if (import.meta.main) {
  const count = verifyWindowsLocalManifest();
  console.log(`WINDOWS_LOCAL_MANIFEST_OK files=${count}`);
}
