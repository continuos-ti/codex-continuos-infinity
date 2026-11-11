import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordBrokerCallEvent } from "../src/adapters/chatgpt-web/broker-call-journal";
import { inspectBrokerCallJournal } from "../src/adapters/chatgpt-web/broker-call-reconciliation";
import { publishPrivateIncident } from "../src/adapters/chatgpt-web/private-incident-journal";
import { callTurnBroker, RemoteTurnBroker, TurnBroker, type BrokerToolResult } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";

const roots: string[] = [];
const traceId = "ab12cd34ef56";
const callId = `call_${"A".repeat(32)}`;
const result: BrokerToolResult = { content: [{ type: "text", text: "private tool output" }] };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "infinity-broker-call-"));
  roots.push(root);
  return { root, directory: join(root, "diagnostics", "broker-calls") };
}

function evidenceFiles(directory: string, trace = traceId) {
  return readdirSync(join(directory, trace)).filter(name => name.endsWith(".json"))
    .map(name => JSON.parse(readFileSync(join(directory, trace, name), "utf8")) as {event: string; callId: string});
}

function eventPath(directory: string, trace: string, id: string, event: string) {
  const digest = createHash("sha256").update(`v1:${id}:${event}`).digest("hex");
  return join(directory, trace, `${digest}.json`);
}

test("durable event records contain no arguments, results, paths, or unvalidated tool names", () => {
  const { directory } = fixture();
  const first = recordBrokerCallEvent({ directory, traceId, callId,
    wireName: "exec_command", event: "queued", now: new Date("2026-11-10T10:00:00.000Z") });
  expect(first.recorded).toBe(true);
  const second = recordBrokerCallEvent({ directory, traceId, callId,
    wireName: "exec_command", event: "queued", now: new Date("2026-11-10T11:00:00.000Z") });
  expect(second).toEqual({ path: first.path, recorded: false });
  const contents = readFileSync(first.path, "utf8");
  expect(JSON.parse(contents)).toEqual({ version: 1, traceId, callId, tool: "exec_command",
    event: "queued", recordedAt: "2026-11-10T10:00:00.000Z", resultRecoverable: false, replayAuthorized: false });
  expect(contents).not.toContain(directory);
  expect(() => recordBrokerCallEvent({ directory, traceId, callId, wireName: "other_tool", event: "queued" }))
    .toThrow("Conflicting broker call journal event");
  recordBrokerCallEvent({ directory, traceId, callId: `call_${"B".repeat(32)}`,
    wireName: "private token=secret", event: "delivery_possible" });
  const content = JSON.stringify(evidenceFiles(directory));
  expect(content).not.toContain("secret");
  expect(content).toContain("unclassified_tool");
  if (process.platform !== "win32") {
    expect(statSync(first.path).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, traceId)).mode & 0o777).toBe(0o700);
  }
});

test("startup reconciles observation boundaries without granting replay or claiming stored results", () => {
  const { directory } = fixture();
  expect(inspectBrokerCallJournal(directory)).toEqual([]);
  const ids = Array.from({ length: 5 }, (_, i) => `call_${String(i).repeat(32)}`);
  const add = (i: number, event: "queued" | "delivery_possible" | "result_received"
    | "compaction_resolution_possible" | "retired_uncertain") => recordBrokerCallEvent({
      directory, traceId, callId: ids[i]!, wireName: "test_tool", event,
  });
  for (let i = 0; i < ids.length; i++) add(i, "queued");
  for (const i of [1, 2, 4]) add(i, "delivery_possible");
  add(2, "result_received");
  add(3, "compaction_resolution_possible");
  add(4, "retired_uncertain");
  mkdirSync(join(directory, traceId), { recursive: true });
  writeFileSync(join(directory, traceId, "." + "a".repeat(64) + "." + "b".repeat(24) + ".pending"), "{unfinished");

  const recovered = inspectBrokerCallJournal(directory);
  expect(recovered.map(e => e.state)).toEqual([
    "queued_unconfirmed", "delivery_unknown", "result_unavailable",
    "compaction_resolution_unavailable", "retired_uncertain",
  ]);
  expect(recovered.every(entry => entry.replayAuthorized === false && entry.resultRecoverable === false)).toBe(true);
  expect(JSON.stringify(recovered)).not.toContain("private tool output");
  // A second process sees the same conservative classification: this is never live state.
  expect(inspectBrokerCallJournal(directory)).toEqual(recovered);
});

test("native thread and turn identities are linked to calls through direct and socket owners", async () => {
  const { root, directory } = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "socket")));
  const remote = new RemoteTurnBroker(broker.socketPath);
  broker.enableCallJournal(directory);
  const environment = { cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const }, tools: [] };
  const firstIdentity = {
    threadId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222",
  };
  const secondIdentity = {
    threadId: "33333333-3333-4333-8333-333333333333",
    turnId: "44444444-4444-4444-8444-444444444444",
  };
  const digestOf = ({ threadId, turnId }: typeof firstIdentity) =>
    createHash("sha256").update(JSON.stringify([threadId, turnId])).digest("hex");
  try {
    const directToken = await broker.register(environment, 20_000, traceId, firstIdentity);
    const remoteToken = await remote.register(environment, 20_000, traceId, secondIdentity);
    const legacyToken = await broker.register(environment, 20_000, traceId);
    const tokens = [directToken, remoteToken, legacyToken];
    const claims = await Promise.all(tokens.map(token =>
      callTurnBroker<{ bindingId: string }>(broker.socketPath, { method: "claim", token })));
    const pending = claims.map(({ bindingId }) => callTurnBroker<BrokerToolResult>(broker.socketPath, {
      method: "invoke", bindingId, wireName: "test_tool", arguments: { password: "secret" },
    }, 15_000));
    const batches = await Promise.all([
      broker.nextToolBatch(directToken),
      remote.nextToolBatch(remoteToken),
      broker.nextToolBatch(legacyToken),
    ]);
    expect(batches.every(batch => batch.length === 1)).toBe(true);
    const callIds = batches.map(batch => batch[0]!.callId);
    expect(() => broker.completeTool(directToken, callIds[1]!, result)).toThrow("not pending");
    broker.completeTool(directToken, callIds[0]!, result);
    await remote.completeTool(remoteToken, callIds[1]!, result);
    broker.completeTool(legacyToken, callIds[2]!, result);
    expect(await Promise.all(pending)).toEqual([result, result, result]);

    const calls = inspectBrokerCallJournal(directory);
    expect(calls).toHaveLength(3);
    expect(calls.find(call => call.callId === callIds[0])?.nativeOwnerDigest).toBe(digestOf(firstIdentity));
    expect(calls.find(call => call.callId === callIds[1])?.nativeOwnerDigest).toBe(digestOf(secondIdentity));
    expect(calls.find(call => call.callId === callIds[2])?.nativeOwnerDigest).toBeUndefined();
    expect(calls.every(call => call.state === "result_unavailable"
      && call.resultRecoverable === false && call.replayAuthorized === false)).toBe(true);
    const persisted = JSON.stringify(evidenceFiles(directory));
    expect(persisted).not.toContain(firstIdentity.threadId);
    expect(persisted).not.toContain(firstIdentity.turnId);
    expect(persisted).not.toContain(secondIdentity.threadId);
    expect(persisted).not.toContain(secondIdentity.turnId);
    expect(persisted).not.toContain("secret");
    expect(persisted).not.toContain("private tool output");
  } finally {
    await broker.close();
  }
});

test("native owner digest is consistent, strictly formatted, and rejects conflicting journal evidence", () => {
  const { directory } = fixture();
  const digest = "a".repeat(64);
  const otherDigest = "b".repeat(64);
  expect(() => recordBrokerCallEvent({ directory, traceId, callId, wireName: "test_tool",
    event: "queued", nativeOwnerDigest: digest.toUpperCase() })).toThrow("Invalid broker native owner digest");
  recordBrokerCallEvent({ directory, traceId, callId, wireName: "test_tool",
    event: "queued", nativeOwnerDigest: digest });
  expect(() => recordBrokerCallEvent({ directory, traceId, callId, wireName: "test_tool",
    event: "queued", nativeOwnerDigest: otherDigest })).toThrow("Conflicting broker call journal event");
  recordBrokerCallEvent({ directory, traceId, callId, wireName: "test_tool",
    event: "delivery_possible", nativeOwnerDigest: digest });
  expect(inspectBrokerCallJournal(directory)[0]?.nativeOwnerDigest).toBe(digest);
  const deliveryPath = eventPath(directory, traceId, callId, "delivery_possible");
  const delivery = readFileSync(deliveryPath, "utf8");
  writeFileSync(deliveryPath, delivery.replace(digest, otherDigest));
  expect(() => inspectBrokerCallJournal(directory)).toThrow("invalid or inconsistent evidence");
  writeFileSync(deliveryPath, delivery.replace(digest, "x".repeat(64)));
  expect(() => inspectBrokerCallJournal(directory)).toThrow("invalid or inconsistent evidence");
  writeFileSync(deliveryPath, delivery);
  expect(inspectBrokerCallJournal(directory)).toHaveLength(1);
});

test("reconciliation fails closed on tampering, inconsistent transitions and missing records", () => {
  const { directory } = fixture();
  recordBrokerCallEvent({ directory, traceId, callId, wireName: "test_tool", event: "queued" });
  const path = eventPath(directory, traceId, callId, "queued");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace('"replayAuthorized":false', '"replayAuthorized":true'));
  expect(() => inspectBrokerCallJournal(directory)).toThrow("invalid or inconsistent evidence");
  writeFileSync(path, original);
  // A syntactically valid timestamp must also represent that exact UTC instant.
  writeFileSync(path, original.replace(/"recordedAt":"[^"]+"/, '"recordedAt":"2026-02-31T10:00:00.000Z"'));
  expect(() => inspectBrokerCallJournal(directory)).toThrow("invalid or inconsistent evidence");
  writeFileSync(path, original);
  recordBrokerCallEvent({ directory, traceId, callId, wireName: "test_tool", event: "result_received" });
  expect(() => inspectBrokerCallJournal(directory)).toThrow("invalid or inconsistent evidence");
  recordBrokerCallEvent({ directory, traceId, callId, wireName: "test_tool", event: "delivery_possible" });
  expect(inspectBrokerCallJournal(directory)).toHaveLength(1);
  writeFileSync(join(directory, traceId, "0".repeat(64) + ".json"), "{broken");
  expect(() => inspectBrokerCallJournal(directory)).toThrow("invalid or inconsistent evidence");
});

test("rejects malformed identities and preserves an orphan pending file without treating it as a completed event", () => {
  const { directory } = fixture();
  expect(() => publishPrivateIncident(directory, "a".repeat(64), {}))
    .toThrow("Invalid incident trace id");
  expect(() => recordBrokerCallEvent({ directory, traceId: "../escape", callId, wireName: "ok", event: "queued" }))
    .toThrow("Invalid broker trace id");
  expect(() => recordBrokerCallEvent({ directory, traceId, callId: "call_../../escape", wireName: "ok", event: "queued" }))
    .toThrow("Invalid broker call id");
  mkdirSync(join(directory, traceId), { recursive: true });
  writeFileSync(join(directory, traceId, ".orphan.pending"), "{broken");
  const saved = recordBrokerCallEvent({ directory, traceId, callId, wireName: "ok", event: "queued" });
  expect(saved.recorded).toBe(true);
  expect(evidenceFiles(directory)).toHaveLength(1);
  expect(readdirSync(join(directory, traceId))).toContain(".orphan.pending");
});

test("broker journals dispatch boundaries, exact reconnect replay, results, and uncertain retirements", async () => {
  const { root, directory } = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "socket")));
  broker.enableCallJournal(directory);
  const environment = { cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const },
    tools: [{ name: "test_tool", description: "Test", parameters: { type: "object" } }] };
  try {
    const tokens = await Promise.all(Array.from({ length: 3 }, () => broker.register(environment, 20_000, traceId)));
    const claims = await Promise.all(tokens.map(token =>
      callTurnBroker<{bindingId: string}>(broker.socketPath, { method: "claim", token })));
    const pending = claims.map((claim, i) => callTurnBroker<BrokerToolResult>(broker.socketPath,
      { method: "invoke", bindingId: claim.bindingId, wireName: "test_tool", arguments: { password: `private-${i}` } }, 15_000));
    const batches = await Promise.all(tokens.map(token => broker.nextToolBatch(token)));
    expect(batches.every(batch => batch.length === 1)).toBe(true);
    const [first] = batches[0]!;
    const [replayed] = await broker.nextToolBatch(tokens[0]!);
    expect(replayed!.callId).toBe(first!.callId);
    broker.completeTool(tokens[0]!, first!.callId, result);
    expect(await pending[0]).toEqual(result);
    // The acknowledgement may be retried if its socket response was lost. The
    // same owner accepts identical receipts without re-running the invocation.
    const duplicateReceipts = await Promise.all(Array.from({ length: 3 }, () =>
      callTurnBroker<{ completed: boolean }>(broker.socketPath, {
        method: "owner_complete", token: tokens[0]!, callId: first!.callId,
        toolResult: structuredClone(result),
      })));
    expect(duplicateReceipts).toEqual(Array.from({ length: 3 }, () => ({ completed: true })));
    await expect(callTurnBroker(broker.socketPath, {
      method: "owner_complete", token: tokens[0]!, callId: first!.callId,
      toolResult: { content: [{ type: "text", text: "conflicting output" }] },
    })).rejects.toThrow("Conflicting result");
    await expect(callTurnBroker(broker.socketPath, {
      method: "owner_complete", token: tokens[2]!, callId: first!.callId,
      toolResult: result,
    })).rejects.toThrow("not pending");
    broker.revoke(tokens[1]!);
    await expect(pending[1]).rejects.toThrow();
    broker.completeTool(tokens[2]!, batches[2]![0]!.callId, result);
    expect(await pending[2]).toEqual(result);
    const entries = evidenceFiles(directory);
    expect(entries).toHaveLength(9); // 3 queued, 3 delivered, 2 results, 1 uncertain; replay deduplicated
    expect(entries.filter(e => e.event === "delivery_possible")).toHaveLength(3);
    expect(entries.filter(e => e.event === "result_received")).toHaveLength(2);
    expect(entries.filter(e => e.event === "retired_uncertain")).toHaveLength(1);
    expect(entries.every(e => !JSON.stringify(e).includes("private"))).toBe(true);
    expect(() => broker.enableCallJournal(join(root, "another"))).toThrow("cannot be enabled or changed");
  } finally {
    await broker.close();
  }
});

test("disk errors do not queue a new invocation or cross delivery and result boundaries", async () => {
  const { root, directory } = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "socket")));
  broker.enableCallJournal(directory);
  const environment = { cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const },
    tools: [{ name: "test_tool", description: "Test", parameters: { type: "object" } }] };
  const token = await broker.register(environment, 20_000, traceId);
  const claim = await callTurnBroker<{bindingId: string}>(broker.socketPath, { method: "claim", token });
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, traceId), "block-journal-directory");
    await expect(callTurnBroker(broker.socketPath, { method: "invoke", bindingId: claim.bindingId,
      wireName: "test_tool" })).rejects.toThrow();
    rmSync(join(directory, traceId));

    const pending = callTurnBroker<BrokerToolResult>(broker.socketPath,
      { method: "invoke", bindingId: claim.bindingId, wireName: "test_tool" });
    // Wait until the queued call has been durably recorded, without crossing delivery.
    let queued: {callId: string}[] = [];
    for (let i = 0; i < 100; i++) {
      if (existsSync(join(directory, traceId))
        && readdirSync(join(directory, traceId), { withFileTypes: true }).some(e => e.name.endsWith(".json"))) break;
      await Bun.sleep(5);
    }
    queued = evidenceFiles(directory).filter(e => e.event === "queued");
    expect(queued).toHaveLength(1);
    const id = queued[0]!.callId;
    const blocker = eventPath(directory, traceId, id, "delivery_possible");
    mkdirSync(blocker);
    await expect(broker.nextToolBatch(token)).rejects.toThrow();
    rmSync(blocker, { recursive: true });
    const [delivered] = await broker.nextToolBatch(token);
    expect(delivered!.callId).toBe(id);

    const resultBlocker = eventPath(directory, traceId, id, "result_received");
    mkdirSync(resultBlocker);
    expect(() => broker.completeTool(token, id, result)).toThrow();
    expect((await broker.nextToolBatch(token))[0]!.callId).toBe(id);
    rmSync(resultBlocker, { recursive: true });
    broker.completeTool(token, id, result);
    expect(await pending).toEqual(result);
    expect(evidenceFiles(directory).map(e => e.event).sort())
      .toEqual(["delivery_possible", "queued", "result_received"]);
  } finally { await broker.close(); }
});

test("compaction journals internal resolution before changing pending calls or accepting a retry", async () => {
  const { root, directory } = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "socket")));
  broker.enableCallJournal(directory);
  const token = await broker.register({ cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" }, tools: [] }, 20_000, traceId);
  const { bindingId } = await callTurnBroker<{ bindingId: string }>(broker.socketPath, { method: "claim", token });
  try {
    const pending = callTurnBroker<BrokerToolResult>(broker.socketPath,
      { method: "invoke", bindingId, wireName: "mutating_tool", arguments: { token: "secret" } }, 15_000);
    for (let i = 0; i < 100; i++) {
      if (existsSync(join(directory, traceId)) && evidenceFiles(directory).some(e => e.event === "queued")) break;
      await Bun.sleep(5);
    }
    const queued = evidenceFiles(directory).filter(e => e.event === "queued");
    expect(queued).toHaveLength(1);
    const blocker = eventPath(directory, traceId, queued[0]!.callId, "compaction_resolution_possible");
    mkdirSync(blocker);
    expect(() => broker.requestCompaction(token, result)).toThrow();
    rmSync(blocker, { recursive: true });
    expect(broker.requestCompaction(token, result)).toBe(1);
    expect(await pending).toEqual(result);
    expect(evidenceFiles(directory).map(e => e.event).sort())
      .toEqual(["compaction_resolution_possible", "queued"]);
    expect(JSON.stringify(evidenceFiles(directory))).not.toContain("secret");
    await expect(broker.nextToolBatch(token)).rejects.toThrow("compaction");
  } finally { await broker.close(); }
});

test("failed retirement journal still rejects an already-delivered tool call", async () => {
  const { root, directory } = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "socket")));
  broker.enableCallJournal(directory);
  const token = await broker.register({ cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" }, tools: [] }, 20_000, traceId);
  const { bindingId } = await callTurnBroker<{ bindingId: string }>(broker.socketPath, { method: "claim", token });
  try {
    const pending = callTurnBroker<BrokerToolResult>(broker.socketPath,
      { method: "invoke", bindingId, wireName: "test_tool" }, 5_000);
    const [delivered] = await broker.nextToolBatch(token);
    expect(delivered).toBeDefined();
    const blocker = eventPath(directory, traceId, delivered!.callId, "retired_uncertain");
    mkdirSync(blocker);
    broker.revoke(token);
    const outcome = await Promise.race([
      pending.then(() => "unexpected success", error => String(error)),
      Bun.sleep(2_000).then(() => "timed out awaiting retirement"),
    ]);
    rmSync(blocker, { recursive: true });
    expect(outcome).toContain("Codex turn binding was revoked");
    expect(evidenceFiles(directory).map(e => e.event).sort()).toEqual(["delivery_possible", "queued"]);
  } finally { await broker.close(); }
});

test("a timer delivery disk failure rejects its waiter and leaves the call queued for retry", async () => {
  const { root, directory } = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "socket")));
  broker.enableCallJournal(directory);
  const token = await broker.register({ cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" }, tools: [] }, 20_000, traceId);
  const { bindingId } = await callTurnBroker<{ bindingId: string }>(broker.socketPath, { method: "claim", token });
  // Fault injection runs synchronously at the timer's delivery boundary, independent of
  // timing or scheduler load. The actual timer handler and retry logic run unchanged.
  const internals = broker as unknown as { wakeToolWaiters(channel: unknown): void };
  const actualWake = internals.wakeToolWaiters.bind(broker);
  let blocker: string | undefined;
  internals.wakeToolWaiters = channel => {
    const queued = evidenceFiles(directory).find(entry => entry.event === "queued");
    if (queued) {
      blocker = eventPath(directory, traceId, queued.callId, "delivery_possible");
      mkdirSync(blocker);
    }
    actualWake(channel);
  };
  try {
    const adapter = broker.nextToolBatch(token);
    const pending = callTurnBroker<BrokerToolResult>(broker.socketPath,
      { method: "invoke", bindingId, wireName: "test_tool" }, 15_000);
    await expect(adapter).rejects.toThrow();
    expect(blocker).toBeDefined();
    internals.wakeToolWaiters = actualWake;
    if (blocker) rmSync(blocker, { recursive: true });
    expect(evidenceFiles(directory).map(entry => entry.event)).toEqual(["queued"]);
    const [delivered] = await broker.nextToolBatch(token);
    expect(delivered).toBeDefined();
    broker.completeTool(token, delivered!.callId, result);
    expect(await pending).toEqual(result);
    expect(evidenceFiles(directory).map(entry => entry.event).sort())
      .toEqual(["delivery_possible", "queued", "result_received"]);
  } finally {
    internals.wakeToolWaiters = actualWake;
    if (blocker && existsSync(blocker)) rmSync(blocker, { recursive: true });
    await broker.close();
  }
});
