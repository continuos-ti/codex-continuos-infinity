import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CHATGPT_COMPLETION_ACTION_GRACE_MS,
  CHATGPT_SILENT_TURN_RECOVERY_PROBE_MS,
  ChatGptTurnDomHealthTracker,
  shouldProbeChatGptSilentTurnRecovery,
  shouldRecheckChatGptSilentTurnFinalAnswer,
} from "../src/adapters/chatgpt-web/browser-worker";

const idle = {
  responsePresent: true,
  running: false,
  responseStreamActive: false,
  externalProgressLive: false,
  externalToolCallsInFlight: false,
  currentText: "",
  completionActionVisible: false,
};

test("silent-turn recovery requires prolonged inactivity and runs once per accepted turn", () => {
  expect(CHATGPT_SILENT_TURN_RECOVERY_PROBE_MS).toBe(90_000);
  expect(shouldProbeChatGptSilentTurnRecovery(idle, 89_999, false)).toBe(false);
  expect(shouldProbeChatGptSilentTurnRecovery(idle, 90_000, false)).toBe(true);
  expect(shouldProbeChatGptSilentTurnRecovery({ ...idle, currentText: "unfinished response" }, 90_000, false)).toBe(true);
  expect(shouldProbeChatGptSilentTurnRecovery(idle, 2_000_000, true)).toBe(false);
});

test("active stream, visible generation, MCP work, final answer and missing DOM veto recovery", () => {
  for (const evidence of [
    { running: true },
    { responseStreamActive: true },
    { externalProgressLive: true },
    { externalToolCallsInFlight: true },

    { completionActionVisible: true },
    { responsePresent: false },
  ]) {
    expect(shouldProbeChatGptSilentTurnRecovery({ ...idle, ...evidence }, 90_001, false)).toBe(false);
  }
});

test("long-running work is not declared idle after 60 seconds", () => {
  expect(CHATGPT_COMPLETION_ACTION_GRACE_MS).toBe(10 * 60_000);
  const monitor = new ChatGptTurnDomHealthTracker();
  const noAnswer = { responsePresent: true, running: false, currentText: "",
    completionActionVisible: false };
  expect(monitor.update(noAnswer, 0)).toBeUndefined();
  expect(monitor.update(noAnswer, 60_000)).toBeUndefined();
  expect(monitor.update(noAnswer, 599_999)).toBeUndefined();
  expect(monitor.update(noAnswer, 600_000)).toContain("without a final answer");
});

test("recovery operates on same bound tab and does not re-send prompts or repeat tool calls", () => {
  const source = readFileSync(new URL("../src/adapters/chatgpt-web/browser-worker.ts", import.meta.url), "utf8");
  const start = source.indexOf('if (shouldProbeChatGptSilentTurnRecovery({');
  const end = source.indexOf('if (running) sawRunning = true;', start);
  const recovery = source.slice(start, end);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  expect(recovery).toContain('rebindLauncherPage(1');
  expect(recovery).toContain('responseDomCache.snapshot = undefined');
  expect(recovery).toContain('silentRecoveryAttempted = true');
  expect(recovery).not.toMatch(/sendAttachedPrompt|press\("Enter"\)|\.click\(|page\.goto\(/);
  expect(source).toContain('code: "chatgpt_stalled_same_turn", retryable: false');
});

test("missing final-action health error triggers a fresh DOM probe before terminal failure", () => {
  const health = new ChatGptTurnDomHealthTracker(1_000, 500, 750);
  const idleAnswer = { responsePresent: true, running: false, currentText: "partial answer",
    completionActionVisible: false };
  expect(health.update(idleAnswer, 0)).toBeUndefined();
  expect(health.update(idleAnswer, 749)).toBeUndefined();
  const domError = health.update(idleAnswer, 750);
  expect(domError).toContain("no new response activity");
  expect(shouldRecheckChatGptSilentTurnFinalAnswer(domError)).toBe(true);
  expect(shouldRecheckChatGptSilentTurnFinalAnswer(
    "ChatGPT stopped showing generation or tool activity without a final answer.")).toBe(true);
  expect(shouldRecheckChatGptSilentTurnFinalAnswer(
    "ChatGPT did not expose its completed-turn action")).toBe(true);
  expect(shouldRecheckChatGptSilentTurnFinalAnswer(
    "ChatGPT response DOM disappeared while the browser turn was active")).toBe(false);
  expect(shouldRecheckChatGptSilentTurnFinalAnswer(undefined)).toBe(false);
});
