import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withChatGptAttachmentUploadLease } from "../src/adapters/chatgpt-web/attachment-upload-lease";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";

async function scratch(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "codex-upload-lease-"));
  try { await fn(join(dir, "active.lock")); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test("multiple Codex helper uploads serialize while their own tasks remain independently executable", async () => {
  await scratch(async path => {
    let active = 0;
    let peak = 0;
    const completed: number[] = [];
    await Promise.all([1, 2, 3].map(async index => {
      await withChatGptAttachmentUploadLease(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Bun.sleep(45);
        completed.push(index);
        active -= 1;
      }, undefined, { path, maxWaitMs: 5_000 });
    }));
    expect(peak).toBe(1);
    expect(completed).toHaveLength(3);
  });
});

test("a cancelled queued upload does not execute or corrupt the first helper's lease", async () => {
  await scratch(async path => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const first = withChatGptAttachmentUploadLease(async () => { entered(); await held; }, undefined, { path });
    await started;
    const blocked = withChatGptAttachmentUploadLease(async () => { throw new Error("must not execute"); },
      AbortSignal.timeout(70), { path });
    await expect(blocked).rejects.toThrow();
    release();
    await first;
    await withChatGptAttachmentUploadLease(async () => {}, undefined, { path });
  });
});

test("queue expiry is explicit and nonretryable rather than silently resending the prompt", async () => {
  await scratch(async path => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const first = withChatGptAttachmentUploadLease(async () => { entered(); await held; }, undefined, { path });
    await started;
    const failure = await withChatGptAttachmentUploadLease(async () => "unexpected", undefined,
      { path, maxWaitMs: 5 }).catch(error => error);
    expect(failure).toBeInstanceOf(ChatGptWebAdapterError);
    expect(failure.code).toBe("chatgpt_attachment_queue_busy");
    expect(failure.retryable).toBe(false);
    release();
    await first;
  });
});

test("an abandoned helper lock is reclaimed after its PID is no longer running", async () => {
  await scratch(async path => {
    writeFileSync(path, JSON.stringify({ pid: 2147483646, token: "abandoned", createdAt: Date.now() - 70_000 }));
    const before = new Date(Date.now() - 70_000);
    utimesSync(path, before, before);
    let ran = false;
    await withChatGptAttachmentUploadLease(async () => { ran = true; },
      undefined, { path, maxWaitMs: 3_000 });
    expect(ran).toBe(true);
  });
});
