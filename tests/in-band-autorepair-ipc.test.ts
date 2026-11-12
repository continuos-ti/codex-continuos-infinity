import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LauncherBrowserHelperClient } from "../src/adapters/chatgpt-web/launcher-helper-client";
import type { ResolvedBrowserConfig } from "../src/adapters/chatgpt-web/browser-worker";
import { LAUNCHER_BROWSER_IDLE_URL, LAUNCHER_BROWSER_HOST_KIND } from "../src/launcher-browser-host";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("real helper IPC delivers one distinct repair instruction with the active tool token", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-inband-repair-ipc-"));
  roots.push(root);
  const helper = join(root, "helper.ts");
  const workerPath = JSON.stringify(new URL("../src/adapters/chatgpt-web/browser-worker.ts", import.meta.url).href);
  const helperPath = JSON.stringify(new URL("../src/adapters/chatgpt-web/browser-helper-main.ts", import.meta.url).href);
  const mockCode = [
    "import { ChatGptBrowserWorker } from " + workerPath + ";",
    "ChatGptBrowserWorker.prototype.run = async function(turn) {",
    "  if (!turn.prepareRecovery) throw new Error('recovery callback absent');",
    "  await turn.onPreparedSelected(false);",
    "  const original = await turn.prepare();",
    "  if (original.text !== 'ORIGINAL_NON_MUTABLE') throw new Error('original prompt was lost');",
    "  const repaired = await turn.prepareRecovery({traceId:turn.traceId,code:'chatgpt_stalled_same_turn'});",
    "  if (repaired.text !== 'REPAIR_DIAGNOSTIC_NO_REPLAY') throw new Error('repair prompt mismatch');",
    "  if (repaired.turnToken !== 'turn_00000000000000000000000000000001') throw new Error('tool token mismatch');",
    "  turn.onCommentary?.('Reparando');",
    "  turn.onTextDelta('RECOVERED');",
    "  return 'RECOVERED';",
    "};",
    "await import(" + helperPath + ");",
  ].join("\n");
  writeFileSync(helper, mockCode, { mode: 0o700 });
  const descriptorHelper = join(root, "descriptor-helper.cjs");
  writeFileSync(descriptorHelper, "process.exit(99);\\n", { mode: 0o700 });
  const descriptorPath = join(root, "not-used.json");
  writeFileSync(descriptorPath, JSON.stringify({
    version: 3, kind: LAUNCHER_BROWSER_HOST_KIND, profile: "production", pid: process.pid,
    endpoint: "http://127.0.0.1:39001", control: {
      endpoint: "http://127.0.0.1:39002", token: "launcher-control-token-0123456789abcdefghijklmnop",
    },
    helper: { executable: process.execPath, script: descriptorHelper },
    partition: "persist:codex-continuos-infinity-chatgpt",
    idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId: "launcher_surface_id_0123456789AB",
    surfaceTargets: { launcher_surface_id_0123456789AB: "native-owned-target" },
    createdAt: new Date().toISOString(),
  }), { mode: 0o600 });
  const config: ResolvedBrowserConfig = {
    appName: "ContinuosWebIntegracao", browserHost: "launcher",
    browserHostDescriptorPath: join(root, "not-used.json"),
    browserHelperScriptPath: helper, storageStatePath: join(root, "unused-state.json"),
    chromeExecutablePath: join(root, "unused-chrome"),
    turnTimeoutMs: 120_000, headed: true, autoApproveToolCalls: false, useTemporaryChats: false,
  };
  const client = new LauncherBrowserHelperClient(config);
  const calls: Array<{traceId:string;code:string}> = [];
  const statuses: string[] = [];
  try {
    const result = await client.run({
      traceId: "repair-ipc-test-01", modelId: "gpt-5.6-sol", reasoning: "high",
      capabilities: { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true },
      prepare: async () => ({ text: "ORIGINAL_NON_MUTABLE", images: [], release() {} }),
      prepareRecovery: async failure => {
        calls.push(failure);
        return { text: "REPAIR_DIAGNOSTIC_NO_REPLAY", images: [],
          turnToken: "turn_00000000000000000000000000000001", release() {} };
      },
      onTextDelta: text => statuses.push(text),
      onCommentary: text => statuses.push(text),
    });
    expect(result).toBe("RECOVERED");
    expect(calls).toEqual([{traceId:"repair-ipc-test-01",code:"chatgpt_stalled_same_turn"}]);
    expect(statuses).toEqual(["Reparando", "RECOVERED"]);
  } finally { await client.close(); }
});
