import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getConfigDir } from "../../config";
import { ChatGptWebAdapterError } from "./adapter-error";

/**
 * Each Codex conversation has its own ChatGPT tab/helper process, but the account
 * shares one upload quota. Admit only one file-upload phase across all helper
 * processes; text-only turns and assistant generation remain concurrent.
 *
 * Exclusive-create is atomic on Windows and survives separate Bun processes.
 * A dead helper's lease is reclaimed only after verifying its PID is gone.
 */
type Owner = { pid: number; token: string; createdAt: number };
const POLL_MS = 250;
const ABANDONED_WRITE_GRACE_MS = 15_000;

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function reclaimOrphan(path: string): Promise<void> {
  try {
    const [file, before] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    let owner: Owner | undefined;
    try { owner = JSON.parse(file) as Owner; } catch {}
    if (owner && isProcessAlive(owner.pid)) return;
    // A different helper can be writing immediately after its atomic create.
    if (Date.now() - before.mtimeMs < ABANDONED_WRITE_GRACE_MS) return;
    // Do not unlink a lease that was replaced while it was being checked.
    const after = await stat(path);
    if (after.ino !== before.ino || after.mtimeMs !== before.mtimeMs) return;
    const confirm = await readFile(path, "utf8");
    if (confirm !== file) return;
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new DOMException("Upload queue aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withChatGptAttachmentUploadLease<T>(
  task: () => Promise<T>,
  signal?: AbortSignal,
  options?: { path?: string; maxWaitMs?: number },
): Promise<T> {
  const path = options?.path ?? join(getConfigDir(), "browser-attachment-upload.lock");
  const maxWaitMs = options?.maxWaitMs ?? 360_000;
  const token = randomUUID();
  const owner: Owner = { pid: process.pid, token, createdAt: Date.now() };
  const started = Date.now();
  await mkdir(dirname(path), { recursive: true });
  let acquired = false;
  for (;;) {
    signal?.throwIfAborted();
    try {
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(owner), "utf8"); }
      finally { await handle.close(); }
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await reclaimOrphan(path);
    if (Date.now() - started > maxWaitMs) {
      throw new ChatGptWebAdapterError(
        "ChatGPT file uploads are busy in other Codex chats. The prompt was not sent; retry once the active uploads finish.",
        { status: 503, errorType: "server_error", code: "chatgpt_attachment_queue_busy", retryable: false },
      );
    }
    await delay(POLL_MS, signal);
  }
  try {
    if (Date.now() - started > 1_000) {
      console.info("[chatgpt-web] attachment upload queue acquired after " + (Date.now() - started) + "ms");
    }
    return await task();
  } finally {
    if (acquired) {
      // Ownership check protects against an orphan cleanup race.
      const content = await readFile(path, "utf8").catch(() => "");
      try {
        if ((JSON.parse(content) as Owner).token === token) await unlink(path);
      } catch {
        // A failed cleanup must not mask the original upload failure.
      }
    }
  }
}
