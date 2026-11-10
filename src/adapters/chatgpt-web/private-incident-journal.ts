import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Publish a complete, file-synced record without exposing partially written JSON as an incident.
 * A same-directory hard link provides atomic first-writer-wins publication across processes.
 * A crash before publication can leave a private .pending file, but never a partial .json.
 */
export function publishPrivateIncident(
  directory: string,
  traceId: string,
  incident: object,
): { path: string; recorded: boolean } {
  if (!/^[0-9a-f]{12}$/.test(traceId)) throw new Error("Invalid incident trace id");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${traceId}.json`);
  const pending = join(directory, `.${traceId}.${randomBytes(12).toString("hex")}.pending`);
  let fd: number | undefined;
  try {
    fd = openSync(pending, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(incident) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
      fd = undefined;
    }
    try {
      linkSync(pending, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return { path, recorded: false };
      throw error;
    }
    // On Unix, sync the directory entry as well; Windows does not expose
    // portable directory-fsync support through the Node/Bun filesystem API.
    if (process.platform !== "win32") {
      const directoryFd = openSync(directory, "r");
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    }
    return { path, recorded: true };
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(pending, { force: true });
  }
}
