import { Database } from "bun:sqlite";
import { mkdirSync, realpathSync } from "node:fs";

/**
 * Hold a SQLite writer transaction for the lifetime of this broker. The lock is shared by all
 * processes, regardless of their socket path, and the OS releases it if the broker crashes.
 * Keep the database adjacent to the journal: the strict journal reader accepts only trace folders.
 */
export function acquireBrokerJournalOwnership(journalDirectory: string): () => void {
  mkdirSync(journalDirectory, { recursive: true, mode: 0o700 });
  // Resolve directory junctions before naming the adjacent lock. Different aliases for the
  // same journal must contend for the same SQLite writer transaction.
  const databasePath = `${realpathSync.native(journalDirectory)}.owner.sqlite`;
  const database = new Database(databasePath, { create: true, strict: true });
  try {
    database.exec("PRAGMA busy_timeout = 0");
    database.exec("BEGIN IMMEDIATE");
  } catch (error) {
    database.close();
    const message = error instanceof Error ? error.message : String(error);
    if (/busy|locked/i.test(message)) {
      throw new Error("Broker call journal is already owned by another process", { cause: error });
    }
    throw error;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    // End the writer transaction explicitly before disposing the native SQLite handle.
    try {
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  };
}
