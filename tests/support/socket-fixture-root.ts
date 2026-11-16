import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Keep Unix-domain socket fixture paths within macOS's 103-byte path limit. */
export function socketFixtureRoot(prefix: string): string {
  return mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), prefix));
}
