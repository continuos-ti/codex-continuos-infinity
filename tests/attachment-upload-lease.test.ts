import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

test("five separate Bun helper processes serialize attachment uploads across the shared account lease", async () => {
  await scratch(async path => {
    const directory = dirname(path);
    const logPath = join(directory, "events.log");
    const helperPath = join(directory, "upload-helper.ts");
    const moduleUrl = new URL("../src/adapters/chatgpt-web/attachment-upload-lease.ts", import.meta.url).href;
    const helperSource = [
      'import { appendFileSync } from "node:fs";',
      `import { withChatGptAttachmentUploadLease } from ${JSON.stringify(moduleUrl)};`,
      'const lockPath = process.env.LOCK_PATH!;',
      'const logPath = process.env.LOG_PATH!;',
      'const helperIndex = process.env.HELPER_INDEX!;',
      'await withChatGptAttachmentUploadLease(async () => {',
      '  appendFileSync(logPath, "start:" + helperIndex + "\\n", "utf8");',
      '  await Bun.sleep(120);',
      '  appendFileSync(logPath, "end:" + helperIndex + "\\n", "utf8");',
      '}, undefined, { path: lockPath, maxWaitMs: 15_000 });',
    ].join("\n");
    writeFileSync(helperPath, helperSource, "utf8");

    const helpers = Array.from({ length: 5 }, (_, index) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [helperPath], {
        env: {
          ...process.env,
          LOCK_PATH: path,
          LOG_PATH: logPath,
          HELPER_INDEX: String(index),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", chunk => { stdout += chunk.toString(); });
      child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Upload helper ${index} exited with code ${code} and signal ${signal}. stdout=${stdout} stderr=${stderr}`));
      });
    }));

    await Promise.all(helpers);
    const events = readFileSync(logPath, "utf8").trim().split("\n");
    expect(events).toHaveLength(10);
    for (let index = 0; index < events.length; index += 2) {
      const [start, startedBy] = events[index].split(":");
      const [end, endedBy] = events[index + 1].split(":");
      expect(start).toBe("start");
      expect(end).toBe("end");
      expect(endedBy).toBe(startedBy);
    }
    expect(existsSync(path)).toBe(false);
  });
}, { timeout: 20_000 });

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
