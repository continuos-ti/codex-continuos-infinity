import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { recordBrokerCallEvent, type BrokerCallEvent } from "../src/adapters/chatgpt-web/broker-call-journal";
import { readAuthenticatedBrokerCallInventory, readAuthenticatedBrokerRecoverySnapshot, readAuthenticatedBrokerResultEvidence, type AuthenticatedBrokerResultEvidence } from "../src/adapters/chatgpt-web/broker-call-reconciliation";
import type { ChatGptRootThreadMetadata, ChatGptThreadSpawnLineage } from "../src/adapters/chatgpt-web/environment";
import { ChatGptThreadEnvironmentStore } from "../src/adapters/chatgpt-web/thread-environment";
import { nativeBrokerOwnerDigest } from "../src/adapters/chatgpt-web/native-broker-owner";
import { BrokerResultVault, vaultDirectoryForJournal } from "../src/adapters/chatgpt-web/sealed-broker-results";
import type { CodexParsedRequest } from "../src/types";

const threadId = "01a06c66-4232-7ae1-9108-69b5f70e0671";
const turnId = "01a06c66-4380-75c6-a0df-318f890ef6de";
const parentThreadId = "01a06c66-18ad-73e1-a641-9b114f2ed10c";
const staleTurnId = "01a06c66-4310-75c6-a0df-318f890ef6de";
const traceId = "ab12cd34ef56";
const callId = `call_${"A".repeat(32)}`;
const result = { content: [{ type: "text", text: "sensitive result body" }] };

let root: string;
let home: string;
let directory: string;
let cwd: string;
let oldKey: string | undefined;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "infinity-authenticated-result-")));
  home = join(root, "native-home");
  directory = join(root, "diagnostics", "broker-calls");
  cwd = join(root, "project");
  mkdirSync(home);
  mkdirSync(cwd);
  oldKey = process.env.CODEX_INFINITY_RESULT_VAULT_KEY;
  if (process.platform !== "win32") process.env.CODEX_INFINITY_RESULT_VAULT_KEY = "ab".repeat(32);
});

afterEach(() => {
  if (oldKey === undefined) delete process.env.CODEX_INFINITY_RESULT_VAULT_KEY;
  else process.env.CODEX_INFINITY_RESULT_VAULT_KEY = oldKey;
  rmSync(root, { force: true, recursive: true });
});

function lineage(child = false): ChatGptRootThreadMetadata | ChatGptThreadSpawnLineage {
  return child
    ? { threadId, parentThreadId, agentName: "/root/worker", sandboxType: "dangerFullAccess", workspaceRoots: [cwd] }
    : { threadId, sandboxType: "dangerFullAccess", workspaceRoots: [cwd] };
}

function nativeRollout(options: { child?: boolean; currentTurn?: string; alternateHome?: string } = {}) {
  const targetHome = options.alternateHome ?? home;
  const path = join(targetHome, "sessions", "2026", "11", "11", `rollout-2026-11-11T02-20-00-${threadId}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [
    { type: "session_meta", payload: {
      id: threadId,
      ...(options.child ? {
        parent_thread_id: parentThreadId, agent_path: "/root/worker", thread_source: "subagent",
        source: { subagent: { thread_spawn: { parent_thread_id: parentThreadId, agent_path: "/root/worker", depth: 1 } } },
      } : { source: "cli" }),
    } },
    { type: "turn_context", payload: {
      turn_id: options.currentTurn ?? turnId, cwd,
      sandbox_policy: { type: "danger-full-access" }, permission_profile: { type: "disabled" },
    } },
  ].map(entry => JSON.stringify(entry)).join("\n") + "\n");
  return path;
}

function journal(events: BrokerCallEvent[] = ["queued", "delivery_possible", "result_received"],
  owner = nativeBrokerOwnerDigest({ threadId, turnId })) {
  for (const event of events) recordBrokerCallEvent({
    directory, traceId, callId, wireName: "mutating_tool", event, nativeOwnerDigest: owner,
  });
}

function seal() {
  new BrokerResultVault(vaultDirectoryForJournal(directory)).seal({
    traceId, callId, tool: "mutating_tool", nativeOwnerDigest: nativeBrokerOwnerDigest({ threadId, turnId })!,
  }, result);
}

function read(options: { owner?: ChatGptRootThreadMetadata | ChatGptThreadSpawnLineage;
  currentTurn?: string; additionalCodexHomes?: string[] } = {}) {
  return readAuthenticatedBrokerResultEvidence({
    codexHome: home, journalDirectory: directory, lineage: options.owner ?? lineage(),
    turnId: options.currentTurn ?? turnId, traceId, callId,
    ...(options.additionalCodexHomes ? { additionalCodexHomes: options.additionalCodexHomes } : {}),
  });
}

function snapshot(options: { owner?: ChatGptRootThreadMetadata | ChatGptThreadSpawnLineage;
  currentTurn?: string; additionalCodexHomes?: string[] } = {}) {
  return readAuthenticatedBrokerRecoverySnapshot({
    codexHome: home, journalDirectory: directory, lineage: options.owner ?? lineage(),
    turnId: options.currentTurn ?? turnId,
    ...(options.additionalCodexHomes ? { additionalCodexHomes: options.additionalCodexHomes } : {}),
  });
}

function parsedNativeTurn(metadata: Record<string, unknown>): CodexParsedRequest {
  return {
    modelId: "chatgpt-web", stream: true, options: { reasoning: "low" },
    context: { tools: [], messages: [] },
    _rawBody: { prompt_cache_key: threadId,
      client_metadata: { "x-codex-turn-metadata": JSON.stringify(metadata) } },
  };
}

test("thread environment store observes an authenticated recovery snapshot without granting replay", () => {
  nativeRollout();
  journal();
  seal();
  const store = new ChatGptThreadEnvironmentStore(undefined, Date.now, home);
  const metadata = {
    request_kind: "turn", thread_id: threadId, turn_id: turnId,
    agent_name: "/root", sandbox_mode: "danger-full-access", workspaces: { [cwd]: {} },
  };
  const recovered = store.readBrokerRecoverySnapshot(directory, parsedNativeTurn(metadata));
  expect(recovered.status).toBe("verified_native_recovery_snapshot");
  if (recovered.status !== "verified_native_recovery_snapshot") throw new Error("Missing authenticated recovery snapshot");
  expect(recovered.calls).toHaveLength(1);
  expect(recovered.calls[0]?.resultEvidence.status).toBe("verified_result_evidence");
  expect(recovered.replayAuthorized).toBe(false);
  expect(recovered.externalEffectsReconciled).toBe(false);

  const stale = store.readBrokerRecoverySnapshot(directory,
    parsedNativeTurn({ ...metadata, turn_id: staleTurnId }));
  expect(stale.status).toBe("unavailable");
  const unbound = store.readBrokerRecoverySnapshot(directory,
    parsedNativeTurn({ ...metadata, request_kind: "untrusted" }));
  expect(unbound.status).toBe("unavailable");
});

const unavailable: AuthenticatedBrokerResultEvidence = {
  status: "unavailable", replayAuthorized: false, externalEffectsReconciled: false,
};

test("current native owner may recover authenticated result evidence without obtaining replay rights", () => {
  nativeRollout();
  journal();
  seal();
  expect(read()).toEqual({ status: "verified_result_evidence", result,
    replayAuthorized: false, externalEffectsReconciled: false });
  const records = JSON.stringify(readFileSync(join(directory, traceId,
    `${createHash("sha256").update(`v1:${callId}:result_received`).digest("hex")}.json`), "utf8"));
  expect(records).not.toContain(result.content[0]!.text);
  expect(records).not.toContain(threadId);
  expect(records).not.toContain(turnId);
});

test("individual authenticated result read rejects journal changes during decryption", () => {
  nativeRollout();
  journal();
  seal();
  const originalRead = BrokerResultVault.prototype.read;
  const eventPath = join(directory, traceId,
    `${createHash("sha256").update(`v1:${callId}:result_received`).digest("hex")}.json`);
  let change: "new_call" | "same_state_rewrite" | "pending" = "new_call";
  BrokerResultVault.prototype.read = function (identity) {
    const value = originalRead.call(this, identity);
    if (change === "new_call") {
      recordBrokerCallEvent({ directory, traceId, callId: `call_${"B".repeat(32)}`,
        wireName: "independent_tool", event: "queued",
        nativeOwnerDigest: nativeBrokerOwnerDigest({ threadId, turnId }) });
    } else if (change === "same_state_rewrite") {
      const record = JSON.parse(readFileSync(eventPath, "utf8")) as { recordedAt: string };
      record.recordedAt = new Date(Date.parse(record.recordedAt) + 1).toISOString();
      writeFileSync(eventPath, JSON.stringify(record));
    } else {
      writeFileSync(join(directory, traceId, `.${"1".repeat(64)}.${"2".repeat(24)}.pending`), "{}");
    }
    return value;
  };
  try {
    expect(read()).toEqual(unavailable);
    change = "same_state_rewrite";
    expect(read()).toEqual(unavailable);
    change = "pending";
    expect(read()).toEqual(unavailable);
  } finally {
    BrokerResultVault.prototype.read = originalRead;
  }
});

test("individual authenticated result read detects a bytewise rewrite of valid sealed evidence", () => {
  nativeRollout();
  journal();
  seal();
  const path = join(vaultDirectoryForJournal(directory), traceId,
    `${createHash("sha256").update(`v1:${callId}:sealed_result`).digest("hex")}.json`);
  const originalRead = BrokerResultVault.prototype.read;
  BrokerResultVault.prototype.read = function (identity) {
    const value = originalRead.call(this, identity);
    writeFileSync(path, JSON.stringify(JSON.parse(readFileSync(path, "utf8")), null, 2));
    return value;
  };
  try {
    expect(read()).toEqual(unavailable);
  } finally {
    BrokerResultVault.prototype.read = originalRead;
  }
  // The rewritten envelope still authenticates, but was not stable during the read.
  expect(read().status).toBe("verified_result_evidence");
});

test("native call inventory authenticates ownership across traces without exposing results or replay rights", () => {
  nativeRollout();
  journal();
  seal();
  const changedTrace = "123456abcdef";
  const pendingCallId = `call_${"B".repeat(32)}`;
  const foreignCallId = `call_${"C".repeat(32)}`;
  const ownerDigest = nativeBrokerOwnerDigest({ threadId, turnId })!;
  recordBrokerCallEvent({ directory, traceId: changedTrace, callId: pendingCallId,
    wireName: "read_tool", event: "queued", nativeOwnerDigest: ownerDigest });
  recordBrokerCallEvent({ directory, traceId: changedTrace, callId: foreignCallId,
    wireName: "other_tool", event: "queued", nativeOwnerDigest: "a".repeat(64) });

  const inventory = readAuthenticatedBrokerCallInventory({
    codexHome: home, journalDirectory: directory, lineage: lineage(), turnId,
  });
  expect(inventory.status).toBe("verified_native_call_inventory");
  if (inventory.status !== "verified_native_call_inventory") throw new Error("Expected authenticated inventory");
  expect(inventory.calls.map(call => ({ traceId: call.traceId, callId: call.callId, state: call.state })))
    .toEqual([
      { traceId: changedTrace, callId: pendingCallId, state: "queued_unconfirmed" },
      { traceId, callId, state: "result_unavailable" },
    ]);
  expect(inventory.calls.every(call => call.replayAuthorized === false && call.resultRecoverable === false))
    .toBe(true);
  expect(inventory.replayAuthorized).toBe(false);
  expect(inventory.externalEffectsReconciled).toBe(false);
  expect(JSON.stringify(inventory)).not.toContain(result.content[0]!.text);
  expect(JSON.stringify(inventory)).not.toContain(foreignCallId);
  expect(JSON.stringify(inventory)).not.toContain(threadId);
  expect(JSON.stringify(inventory)).not.toContain(turnId);
});

test("native call inventory rejects a concurrent journal publication during owner validation", () => {
  nativeRollout();
  journal();
  let rootReads = 0;
  const owner: ChatGptRootThreadMetadata = {
    threadId,
    sandboxType: "dangerFullAccess",
    get workspaceRoots() {
      rootReads += 1;
      // The first owner resolution reads the roots twice. Publish a new call during the
      // second owner resolution, after the inventory's initial journal snapshot.
      if (rootReads === 3) {
        recordBrokerCallEvent({ directory, traceId: "012345abcdef",
          callId: `call_${"B".repeat(32)}`, wireName: "independent_tool", event: "queued",
          nativeOwnerDigest: nativeBrokerOwnerDigest({ threadId, turnId }) });
      }
      return [cwd];
    },
  };
  expect(readAuthenticatedBrokerCallInventory({
    codexHome: home, journalDirectory: directory, lineage: owner, turnId,
  })).toEqual({ status: "unavailable", replayAuthorized: false, externalEffectsReconciled: false });
  expect(rootReads).toBeGreaterThanOrEqual(3);
});

test("recovery snapshot authenticates a mixed multi-trace inventory and each sealed result", () => {
  const rollout = nativeRollout();
  journal();
  seal();
  appendFileSync(rollout, [
    { type: "event_msg", payload: { type: "task_started", turn_id: turnId } },
    { type: "response_item", payload: { type: "function_call", call_id: callId, name: "mutating_tool" } },
    { type: "response_item", payload: { type: "function_call_output", call_id: callId, output: "returned" } },
  ].map(item => JSON.stringify(item)).join("\n") + "\n");
  const pendingCallId = `call_${"B".repeat(32)}`;
  const missingResultCallId = `call_${"C".repeat(32)}`;
  const foreignCallId = `call_${"D".repeat(32)}`;
  const alternateTrace = "012345abcdef";
  const owner = nativeBrokerOwnerDigest({ threadId, turnId })!;
  for (const event of ["queued", "delivery_possible", "result_received"] as const) {
    recordBrokerCallEvent({ directory, traceId: alternateTrace, callId: missingResultCallId,
      wireName: "read_tool", event, nativeOwnerDigest: owner });
  }
  recordBrokerCallEvent({ directory, traceId: alternateTrace, callId: pendingCallId,
    wireName: "pending_tool", event: "queued", nativeOwnerDigest: owner });
  recordBrokerCallEvent({ directory, traceId: alternateTrace, callId: foreignCallId,
    wireName: "foreign_tool", event: "queued", nativeOwnerDigest: "f".repeat(64) });

  const observed = snapshot();
  expect(observed.status).toBe("verified_native_recovery_snapshot");
  if (observed.status !== "verified_native_recovery_snapshot") throw new Error("Missing snapshot");
  expect(observed.calls.map(entry => [entry.call.callId, entry.call.state, entry.resultEvidence.status]))
    .toEqual([
      [pendingCallId, "queued_unconfirmed", "unavailable"],
      [missingResultCallId, "result_unavailable", "unavailable"],
      [callId, "result_unavailable", "verified_result_evidence"],
    ]);
  const sealed = observed.calls[2]!.resultEvidence;
  if (sealed.status !== "verified_result_evidence") throw new Error("Missing sealed result");
  expect(sealed.result).toEqual(result);
  expect(observed.calls.map(entry => entry.nativeOutputEvidence)).toEqual([
    "unavailable", "unavailable", "recorded_in_native_rollout",
  ]);
  expect(observed.replayAuthorized).toBe(false);
  expect(observed.externalEffectsReconciled).toBe(false);
  expect(JSON.stringify(observed)).not.toContain(foreignCallId);
  expect(JSON.stringify(observed)).not.toContain(threadId);
  expect(JSON.stringify(observed)).not.toContain(turnId);
});

test("recovery snapshot does not attribute a native output to a different tool sharing a call ID", () => {
  const rollout = nativeRollout();
  journal();
  seal();
  appendFileSync(rollout, [
    { type: "event_msg", payload: { type: "task_started", turn_id: turnId } },
    { type: "response_item", payload: { type: "function_call", call_id: callId, name: "other_tool" } },
    { type: "response_item", payload: { type: "function_call_output", call_id: callId, output: "returned" } },
  ].map(entry => JSON.stringify(entry)).join("\n") + "\n");

  const recovered = snapshot();
  expect(recovered.status).toBe("verified_native_recovery_snapshot");
  if (recovered.status !== "verified_native_recovery_snapshot") throw new Error("Missing snapshot");
  expect(recovered.calls[0]?.resultEvidence.status).toBe("verified_result_evidence");
  expect(recovered.calls[0]?.nativeOutputEvidence).toBe("unavailable");
  expect(recovered.replayAuthorized).toBe(false);
  expect(recovered.externalEffectsReconciled).toBe(false);
});

test("recovery snapshot rejects native output evidence added during vault decryption", () => {
  const rollout = nativeRollout();
  journal();
  seal();
  const originalRead = BrokerResultVault.prototype.read;
  BrokerResultVault.prototype.read = function (identity) {
    const value = originalRead.call(this, identity);
    appendFileSync(rollout, [
      { type: "event_msg", payload: { type: "task_started", turn_id: turnId } },
      { type: "response_item", payload: { type: "function_call", call_id: callId, name: "mutating_tool" } },
      { type: "response_item", payload: { type: "function_call_output", call_id: callId, output: "returned" } },
    ].map(entry => JSON.stringify(entry)).join("\n") + "\n");
    return value;
  };
  try {
    expect(snapshot()).toEqual({
      status: "unavailable", replayAuthorized: false, externalEffectsReconciled: false,
    });
  } finally {
    BrokerResultVault.prototype.read = originalRead;
  }
  const stable = snapshot();
  expect(stable.status).toBe("verified_native_recovery_snapshot");
  if (stable.status !== "verified_native_recovery_snapshot") throw new Error("Expected stable snapshot");
  expect(stable.calls[0]?.nativeOutputEvidence).toBe("recorded_in_native_rollout");
});

test("recovery snapshot refuses stale authority, ambiguous homes and unowned legacy records", () => {
  nativeRollout();
  journal();
  seal();
  expect(snapshot({ currentTurn: staleTurnId }).status).toBe("unavailable");
  expect(snapshot({ owner: lineage(true) }).status).toBe("unavailable");
  const secondHome = join(root, "secondary");
  nativeRollout({ alternateHome: secondHome });
  expect(snapshot({ additionalCodexHomes: [secondHome] }).status).toBe("unavailable");
  recordBrokerCallEvent({ directory, traceId: "012345abcdef", callId: `call_${"E".repeat(32)}`,
    wireName: "legacy_tool", event: "queued" });
  expect(snapshot().status).toBe("unavailable");
});

test("recovery snapshot rejects native CWD changes during a vault read", () => {
  const rollout = nativeRollout();
  journal();
  seal();
  const movedCwd = join(cwd, "other-worktree");
  mkdirSync(movedCwd);
  const originalRead = BrokerResultVault.prototype.read;
  BrokerResultVault.prototype.read = function (identity) {
    const value = originalRead.call(this, identity);
    appendFileSync(rollout, JSON.stringify({ type: "turn_context", payload: {
      turn_id: turnId, cwd: movedCwd,
      sandbox_policy: { type: "danger-full-access" }, permission_profile: { type: "disabled" },
    } }) + "\n");
    return value;
  };
  try {
    expect(snapshot().status).toBe("unavailable");
  } finally {
    BrokerResultVault.prototype.read = originalRead;
  }
});

test("recovery snapshot rejects journal additions or same-state record modifications during a read", () => {
  nativeRollout();
  journal();
  seal();
  const originalRead = BrokerResultVault.prototype.read;
  const eventPath = join(directory, traceId,
    `${createHash("sha256").update(`v1:${callId}:result_received`).digest("hex")}.json`);
  let change: "add" | "rewrite" = "add";
  BrokerResultVault.prototype.read = function (identity) {
    const value = originalRead.call(this, identity);
    if (change === "add") {
      recordBrokerCallEvent({ directory, traceId, callId: `call_${"F".repeat(32)}`,
        wireName: "another_tool", event: "queued",
        nativeOwnerDigest: nativeBrokerOwnerDigest({ threadId, turnId }) });
    } else {
      const record = JSON.parse(readFileSync(eventPath, "utf8")) as { recordedAt: string };
      record.recordedAt = new Date(Date.parse(record.recordedAt) + 1).toISOString();
      writeFileSync(eventPath, JSON.stringify(record));
    }
    return value;
  };
  try {
    expect(snapshot().status).toBe("unavailable");
    change = "rewrite";
    expect(snapshot().status).toBe("unavailable");
  } finally {
    BrokerResultVault.prototype.read = originalRead;
  }
});

test("recovery snapshot detects a pending journal publication introduced during result recovery", () => {
  nativeRollout();
  journal();
  seal();
  const originalRead = BrokerResultVault.prototype.read;
  BrokerResultVault.prototype.read = function (identity) {
    const value = originalRead.call(this, identity);
    writeFileSync(join(directory, traceId, `.${"1".repeat(64)}.${"2".repeat(24)}.pending`), "{}");
    return value;
  };
  try {
    expect(snapshot().status).toBe("unavailable");
  } finally {
    BrokerResultVault.prototype.read = originalRead;
  }
});

test("pre-existing pending journal publication prevents every authenticated recovery view", () => {
  nativeRollout();
  journal();
  seal();
  const otherTrace = join(directory, "012345abcdef");
  mkdirSync(otherTrace, { recursive: true });
  const pending = join(otherTrace, `.${"1".repeat(64)}.${"2".repeat(24)}.pending`);
  writeFileSync(pending, "{incomplete");

  expect(read()).toEqual(unavailable);
  expect(snapshot()).toEqual(unavailable);
  expect(readAuthenticatedBrokerCallInventory({
    codexHome: home, journalDirectory: directory, lineage: lineage(), turnId,
  })).toEqual(unavailable);

  rmSync(pending);
  expect(read().status).toBe("verified_result_evidence");
  expect(snapshot().status).toBe("verified_native_recovery_snapshot");
  expect(readAuthenticatedBrokerCallInventory({
    codexHome: home, journalDirectory: directory, lineage: lineage(), turnId,
  }).status).toBe("verified_native_call_inventory");
});

test("recovery snapshot rejects concurrent vault rewrites and pending publications", () => {
  nativeRollout();
  journal();
  seal();
  const vaultTrace = join(vaultDirectoryForJournal(directory), traceId);
  const path = join(vaultTrace,
    `${createHash("sha256").update(`v1:${callId}:sealed_result`).digest("hex")}.json`);
  const originalRead = BrokerResultVault.prototype.read;
  let change: "rewrite" | "pending" = "rewrite";
  BrokerResultVault.prototype.read = function (identity) {
    const value = originalRead.call(this, identity);
    if (change === "rewrite") {
      writeFileSync(path, JSON.stringify(JSON.parse(readFileSync(path, "utf8")), null, 2));
    } else {
      writeFileSync(join(vaultTrace, `.${"1".repeat(64)}.${"2".repeat(24)}.pending`), "{}");
    }
    return value;
  };
  try {
    expect(snapshot().status).toBe("unavailable");
    change = "pending";
    expect(snapshot().status).toBe("unavailable");
  } finally {
    BrokerResultVault.prototype.read = originalRead;
  }
});

test("recovery snapshot detects a result published for a previously queued call", () => {
  nativeRollout();
  journal();
  seal();
  const queuedCallId = `call_${"B".repeat(32)}`;
  const owner = nativeBrokerOwnerDigest({ threadId, turnId })!;
  recordBrokerCallEvent({ directory, traceId, callId: queuedCallId,
    wireName: "another_tool", event: "queued", nativeOwnerDigest: owner });
  const originalRead = BrokerResultVault.prototype.read;
  BrokerResultVault.prototype.read = function (identity) {
    const value = originalRead.call(this, identity);
    new BrokerResultVault(vaultDirectoryForJournal(directory)).seal({
      traceId, callId: queuedCallId, tool: "another_tool", nativeOwnerDigest: owner,
    }, result);
    return value;
  };
  try {
    expect(snapshot().status).toBe("unavailable");
  } finally {
    BrokerResultVault.prototype.read = originalRead;
  }
});

test("recovery snapshot bounds accumulated call count and preserves vault authentication errors", () => {
  nativeRollout();
  journal();
  seal();
  const owner = nativeBrokerOwnerDigest({ threadId, turnId })!;
  for (let index = 0; index < 64; index++) {
    const call = `call_${index.toString(36).padStart(32, "0")}`;
    recordBrokerCallEvent({ directory, traceId, callId: call,
      wireName: "additional_tool", event: "queued", nativeOwnerDigest: owner });
  }
  expect(() => snapshot()).toThrow("bounded call count");
  rmSync(join(directory, traceId), { recursive: true, force: true });
  journal();
  const vaultPath = join(vaultDirectoryForJournal(directory), traceId,
    `${createHash("sha256").update(`v1:${callId}:sealed_result`).digest("hex")}.json`);
  const envelope = JSON.parse(readFileSync(vaultPath, "utf8")) as { ciphertext: string };
  envelope.ciphertext = `${envelope.ciphertext.startsWith("A") ? "B" : "A"}${envelope.ciphertext.slice(1)}`;
  writeFileSync(vaultPath, JSON.stringify(envelope));
  expect(() => snapshot()).toThrow("authentication or payload validation failed");
}, 20_000);

test("native call inventory fails closed for stale turn, mismatched lineage, ambiguous home and corrupt journal", () => {
  nativeRollout();
  journal();
  const inventory = (options: { owner?: ChatGptRootThreadMetadata | ChatGptThreadSpawnLineage;
    currentTurn?: string; additionalCodexHomes?: string[] } = {}) => readAuthenticatedBrokerCallInventory({
    codexHome: home, journalDirectory: directory,
    lineage: options.owner ?? lineage(), turnId: options.currentTurn ?? turnId,
    ...(options.additionalCodexHomes ? { additionalCodexHomes: options.additionalCodexHomes } : {}),
  });
  expect(inventory({ currentTurn: staleTurnId }).status).toBe("unavailable");
  expect(inventory({ owner: lineage(true) }).status).toBe("unavailable");
  const secondHome = join(root, "duplicate-home");
  nativeRollout({ alternateHome: secondHome });
  expect(inventory({ additionalCodexHomes: [secondHome] }).status).toBe("unavailable");

  const digest = createHash("sha256").update(`v1:${callId}:queued`).digest("hex");
  writeFileSync(join(directory, traceId, `${digest}.json`), "{broken");
  expect(() => inventory()).toThrow("invalid or inconsistent evidence");
});

test("a missing broker journal cannot be treated as a verified empty inventory", () => {
  nativeRollout();
  expect(readAuthenticatedBrokerCallInventory({
    codexHome: home, journalDirectory: directory, lineage: lineage(), turnId,
  })).toEqual({ status: "unavailable", replayAuthorized: false, externalEffectsReconciled: false });
});

test("legacy calls without native ownership make the authenticated inventory unavailable", () => {
  nativeRollout();
  journal();
  recordBrokerCallEvent({
    directory, traceId: "012345abcdef", callId: `call_${"D".repeat(32)}`,
    wireName: "legacy_mutation", event: "queued",
  });
  expect(readAuthenticatedBrokerCallInventory({
    codexHome: home, journalDirectory: directory, lineage: lineage(), turnId,
  })).toEqual({ status: "unavailable", replayAuthorized: false, externalEffectsReconciled: false });
});

test("missing journal boundary or missing ciphertext never enables recovering a result", () => {
  nativeRollout();
  expect(read()).toEqual(unavailable);
  journal(["queued", "delivery_possible"]);
  seal();
  expect(read()).toEqual(unavailable);
  journal(["result_received"]);
  expect(read().status).toBe("verified_result_evidence");
  rmSync(vaultDirectoryForJournal(directory), { force: true, recursive: true });
  expect(read()).toEqual(unavailable);
});

test("stale turn, mismatched lineage, removed workspace and duplicate native homes fail closed", () => {
  const path = nativeRollout();
  journal();
  seal();
  expect(read({ currentTurn: staleTurnId })).toEqual(unavailable);
  expect(read({ owner: lineage(true) })).toEqual(unavailable);
  expect(read({ owner: { ...lineage(), workspaceRoots: [home] } })).toEqual(unavailable);
  const secondHome = join(root, "secondary");
  nativeRollout({ alternateHome: secondHome });
  expect(read({ additionalCodexHomes: [secondHome] })).toEqual(unavailable);
  rmSync(secondHome, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  expect(read()).toEqual(unavailable);
  expect(existsSync(path)).toBe(true);
});

test("subagent evidence requires canonical parent and agent lineage", () => {
  nativeRollout({ child: true });
  journal();
  seal();
  expect(read({ owner: lineage(true) }).status).toBe("verified_result_evidence");
  expect(read()).toEqual(unavailable);
  expect(read({ owner: { ...lineage(true), parentThreadId: staleTurnId } as ChatGptThreadSpawnLineage }))
    .toEqual(unavailable);
});

test("native cwd changes during vault read invalidate the earlier owner snapshot", () => {
  const rollout = nativeRollout();
  journal();
  seal();
  const movedCwd = join(cwd, "other-worktree");
  mkdirSync(movedCwd);
  const originalRead = BrokerResultVault.prototype.read;
  BrokerResultVault.prototype.read = function (identity) {
    const value = originalRead.call(this, identity);
    appendFileSync(rollout, JSON.stringify({ type: "turn_context", payload: {
      turn_id: turnId, cwd: movedCwd,
      sandbox_policy: { type: "danger-full-access" },
      permission_profile: { type: "disabled" },
    } }) + "\n");
    return value;
  };
  try {
    expect(read()).toEqual(unavailable);
  } finally {
    BrokerResultVault.prototype.read = originalRead;
  }
});

test("owner digest disagreement and malformed result evidence fail closed", () => {
  nativeRollout();
  journal(["queued", "delivery_possible", "result_received"], "b".repeat(64));
  seal();
  expect(read()).toEqual(unavailable);
  const digest = createHash("sha256").update(`v1:${callId}:delivery_possible`).digest("hex");
  const eventPath = join(directory, traceId, `${digest}.json`);
  writeFileSync(eventPath, readFileSync(eventPath, "utf8").replace("b".repeat(64), "c".repeat(64)));
  expect(() => read()).toThrow("invalid or inconsistent evidence");
});

test("ciphertext modification and unavailable decryption key never produce usable evidence", () => {
  nativeRollout();
  journal();
  seal();
  const path = join(vaultDirectoryForJournal(directory), traceId,
    `${createHash("sha256").update(`v1:${callId}:sealed_result`).digest("hex")}.json`);
  const original = readFileSync(path, "utf8");
  const altered = JSON.parse(original) as { ciphertext: string };
  altered.ciphertext = `${altered.ciphertext[0] === "A" ? "B" : "A"}${altered.ciphertext.slice(1)}`;
  writeFileSync(path, JSON.stringify(altered));
  expect(() => read()).toThrow("authentication or payload validation failed");
  writeFileSync(path, original);
  if (process.platform === "win32") {
    rmSync(join(vaultDirectoryForJournal(directory), "keys"), { recursive: true, force: true });
    expect(() => read()).toThrow("key is unavailable");
    expect(existsSync(join(vaultDirectoryForJournal(directory), "keys"))).toBe(false);
  } else {
    delete process.env.CODEX_INFINITY_RESULT_VAULT_KEY;
    expect(() => read()).toThrow("requires a 32-byte configured key");
  }
});
