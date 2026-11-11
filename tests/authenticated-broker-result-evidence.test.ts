import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { recordBrokerCallEvent, type BrokerCallEvent } from "../src/adapters/chatgpt-web/broker-call-journal";
import { readAuthenticatedBrokerCallInventory, readAuthenticatedBrokerResultEvidence, type AuthenticatedBrokerResultEvidence } from "../src/adapters/chatgpt-web/broker-call-reconciliation";
import type { ChatGptRootThreadMetadata, ChatGptThreadSpawnLineage } from "../src/adapters/chatgpt-web/environment";
import { nativeBrokerOwnerDigest } from "../src/adapters/chatgpt-web/native-broker-owner";
import { BrokerResultVault, vaultDirectoryForJournal } from "../src/adapters/chatgpt-web/sealed-broker-results";

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
