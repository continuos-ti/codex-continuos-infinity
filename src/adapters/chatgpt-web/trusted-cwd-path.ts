import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

/** Check a current filesystem fact, not a permission grant inferred from a path string. */
export function cwdIsAccessibleDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

/**
 * A lexical descendant can be a junction or symlink into an unrelated directory.
 * Restrict cwd to the *actual* root on disk for read-only/workspace-write turns.
 * Native Codex remains responsible for enforcing file operations after preflight;
 * these point-in-time checks cannot prevent a later rename or junction swap.
 */
export function cwdWithinRealRoot(root: string, cwd: string): boolean {
  try {
    if (!statSync(root).isDirectory() || !statSync(cwd).isDirectory()) return false;
    const actualRoot = realpathSync.native(root);
    const actualCwd = realpathSync.native(cwd);
    const rel = relative(
      process.platform === "win32" ? actualRoot.toLowerCase() : actualRoot,
      process.platform === "win32" ? actualCwd.toLowerCase() : actualCwd,
    );
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  } catch {
    return false;
  }
}

export function cwdWithinRealRoots(roots: readonly string[], cwd: string): boolean {
  return roots.some(root => cwdWithinRealRoot(root, cwd));
}
