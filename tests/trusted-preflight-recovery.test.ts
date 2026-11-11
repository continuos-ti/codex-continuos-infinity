import { expect, test } from "bun:test";
import { MissingTrustedCodexEnvironmentError } from "../src/adapters/chatgpt-web/environment";
import { resolveTrustedPreflightWithRecovery } from "../src/adapters/chatgpt-web/trusted-preflight-recovery";

const nativeIdentity = {
  threadId: "01a06c66-a0af-7769-b04e-976542277181",
  turnId: "01a06c66-37dc-7c86-85f9-a92e0bb6b638",
};

test("late native rollout is accepted only after the existing authority resolver succeeds", async () => {
  const waits: number[] = [];
  let attempts = 0;
  const resolved = await resolveTrustedPreflightWithRecovery(nativeIdentity, () => {
    attempts += 1;
    if (attempts < 3) throw new MissingTrustedCodexEnvironmentError("cwd");
    return { cwd: "verified-by-native-resolver", sandbox: "verified" };
  }, undefined, async ms => { waits.push(ms); });
  expect(resolved).toEqual({
    value: { cwd: "verified-by-native-resolver", sandbox: "verified" }, recoveryAttempts: 2,
  });
  expect(waits).toEqual([150, 300]);
  expect(attempts).toBe(3);
});

test("exhausted native preflight fails closed without reusing a prior authority", async () => {
  let attempts = 0;
  const failure = new Error("Codex has no canonical rollout for the requested current turn");
  const result = resolveTrustedPreflightWithRecovery(nativeIdentity, () => {
    attempts += 1;
    throw failure;
  }, undefined, async () => {});
  expect(await result.then(() => undefined, error => error)).toBe(failure);
  expect(attempts).toBe(3);
});

test("ambiguous owner, inaccessible cwd, changed policy and non-native IDs never retry", async () => {
  const errors = [
    new Error("Codex thread exists in multiple trusted homes"),
    new Error("Codex rollout cwd no longer exists as an accessible directory"),
    new Error("Current environment conflicts with its current Codex rollout (fields: sandbox_policy)"),
  ];
  for (const error of errors) {
    let attempts = 0;
    expect(await resolveTrustedPreflightWithRecovery(nativeIdentity, () => {
      attempts += 1;
      throw error;
    }, undefined, async () => {}).then(() => undefined, reason => reason)).toBe(error);
    expect(attempts).toBe(1);
  }
  let nonNativeAttempts = 0;
  expect(await resolveTrustedPreflightWithRecovery({ threadId: "opaque", turnId: "opaque" }, () => {
    nonNativeAttempts += 1;
    throw new MissingTrustedCodexEnvironmentError("cwd");
  }, undefined, async () => {}).then(() => "unexpected", error => error.message)).toContain("missing cwd");
  expect(nonNativeAttempts).toBe(1);
});

test("abort during preflight recovery suppresses subsequent attempts", async () => {
  const controller = new AbortController();
  const aborted = new Error("turn cancelled");
  let attempts = 0;
  const outcome = resolveTrustedPreflightWithRecovery(nativeIdentity, () => {
    attempts += 1;
    throw new MissingTrustedCodexEnvironmentError("cwd");
  }, controller.signal, async () => { controller.abort(aborted); });
  expect(await outcome.then(() => undefined, error => error)).toBe(aborted);
  expect(attempts).toBe(1);
});
