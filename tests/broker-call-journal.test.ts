import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordBrokerCallEvent } from "../src/adapters/chatgpt-web/broker-call-journal";
import { inspectBrokerCallJournal } from "../src/adapters/chatgpt-web/broker-call-reconciliation";
import { nativeBrokerOwnerDigest } from "../src/adapters/chatgpt-web/native-broker-owner";
import { BrokerResultVault, vaultDirectoryForJournal } from "../src/adapters/chatgpt-web/sealed-broker-results";
import { publishPrivateIncident } from "../src/adapters/chatgpt-web/private-incident-journal";
import { callTurnBroker, RemoteTurnBroker, TurnBroker, type BrokerToolResult } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";
import { socketFixtureRoot } from "./support/socket-fixture-root";

const roots: string[] = [];
const traceId = "ab12cd34ef56";
const callId = `call_${"A".repeat(32)}`;
const result: BrokerToolResult = { content: [{ type: "text", text: "private tool output" }] };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }); });

function fixture() {
  const root = socketFixtureRoot("infinity-broker-call-");
  roots.push(root);
  return { root, directory: join(root, "diagnostics", "broker-calls") };
}

function evidenceFiles(directory: string, trace = traceId) {
  return readdirSync(join(directory, trace)).filter(name => name.endsWith(".json"))
    .map(name => JSON.parse(readFileSync(join(directory, trace, name), "utf8")) as {
      event: string; callId: string; readOnly?: boolean; providerEpoch?: string; operationStatus?: Record<string, unknown>;
    });
}

function eventPath(directory: string, trace: string, id: string, event: string) {
  const digest = createHash("sha256").update(`v1:${id}:${event}`).digest("hex");
  return join(directory, trace, `${digest}.json`);
}

function sealedPath(directory: string, trace: string, id: string) {
  return join(vaultDirectoryForJournal(directory), trace,
    `${createHash("sha256").update(`v1:${id}:sealed_result`).digest("hex")}.json`);
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

test("provider epochs survive journal reconciliation without persisting tool arguments", () => {
  const { directory } = fixture();
  const providerEpoch = "d".repeat(32);
  const saved = recordBrokerCallEvent({ directory, traceId, callId,
    wireName: "mcp__windows_local__windows_command", event: "queued", providerEpoch });
  const entry = JSON.parse(readFileSync(saved.path, "utf8")) as Record<string, unknown>;

  expect(entry.providerEpoch).toBe(providerEpoch);
  expect(entry).not.toHaveProperty("arguments");
  expect(inspectBrokerCallJournal(directory)[0]?.providerEpoch).toBe(providerEpoch);
  expect(() => recordBrokerCallEvent({ directory, traceId, callId,
    wireName: "mcp__windows_local__windows_command", event: "queued", providerEpoch: "invalid" }))
    .toThrow("Invalid broker provider epoch");
  expect(() => recordBrokerCallEvent({ directory, traceId, callId,
    wireName: "mcp__windows_local__windows_command", event: "queued", providerEpoch: "e".repeat(32) }))
    .toThrow("Conflicting broker call journal event");
});

test("explicit read-only classification survives reconciliation and cannot change between events", () => {
  const { directory } = fixture();
  recordBrokerCallEvent({ directory, traceId, callId, wireName: "mcp__windows_local__windows_command_result",
    event: "queued", readOnly: true });
  expect(inspectBrokerCallJournal(directory)[0]?.readOnly).toBe(true);
  expect(evidenceFiles(directory)[0]?.readOnly).toBe(true);

  recordBrokerCallEvent({ directory, traceId, callId, wireName: "mcp__windows_local__windows_command_result",
    event: "delivery_possible", readOnly: true });
  expect(inspectBrokerCallJournal(directory)[0]?.readOnly).toBe(true);
  recordBrokerCallEvent({ directory, traceId, callId,
    wireName: "mcp__windows_local__windows_command_result", event: "retired_uncertain", readOnly: false });
  expect(() => inspectBrokerCallJournal(directory)).toThrow(/invalid or inconsistent evidence/);
});

test("rejects a provider epoch change across lifecycle events", () => {
  const { directory } = fixture();
  recordBrokerCallEvent({ directory, traceId, callId,
    wireName: "mcp__windows_local__windows_command", event: "queued", providerEpoch: "d".repeat(32) });
  recordBrokerCallEvent({ directory, traceId, callId,
    wireName: "mcp__windows_local__windows_command", event: "delivery_possible", providerEpoch: "e".repeat(32) });

  expect(() => inspectBrokerCallJournal(directory)).toThrow(/invalid or inconsistent evidence/);
});

test("provider operation status contracts survive journal reconciliation and cannot change between events", () => {
  const { directory } = fixture();
  const operationStatus = {
    statusTool: "mcp__windows_local___windows_command_result",
    operationIdArgument: "job_id",
    providerEpochArgument: "provider_epoch",
    waitSecondsArgument: "wait_seconds",
    effectScope: "tracked_process",
  };
  recordBrokerCallEvent({ directory, traceId, callId, wireName: "mcp__windows_local___windows_command",
    event: "queued", providerEpoch: "d".repeat(32), operationStatus });

  const recovered = inspectBrokerCallJournal(directory);
  expect(recovered[0]?.operationStatus).toEqual(operationStatus);
  expect(evidenceFiles(directory)[0]?.operationStatus).toEqual(operationStatus);
  recordBrokerCallEvent({ directory, traceId, callId,
    wireName: "mcp__windows_local___windows_command", event: "delivery_possible",
    providerEpoch: "d".repeat(32), operationStatus: { ...operationStatus, effectScope: "provider_operation" } });
  expect(() => inspectBrokerCallJournal(directory)).toThrow(/invalid or inconsistent evidence/);
});

test("journal rejects malformed provider operation status contracts", () => {
  const { directory } = fixture();
  expect(() => recordBrokerCallEvent({ directory, traceId, callId, wireName: "tracked_tool",
    event: "queued", operationStatus: {
      statusTool: "../status",
      operationIdArgument: "job_id",
      providerEpochArgument: "provider_epoch",
      effectScope: "tracked_process",
    } })).toThrow("Invalid broker operation status contract");
});
test("broker journals the provider epoch advertised when a native tool call is queued", async () => {
  const { root, directory } = fixture();
  const providerEpoch = "f".repeat(32);
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "provider-epoch")));
  broker.enableCallJournal(directory);
  const environment = {
    cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const },
    tools: [{
      name: "windows_command", namespace: "mcp__windows_local", description: "Run a tracked command.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" }, cwd: { type: "string" },
          operation_id: { type: "string" }, provider_epoch: { type: "string" },
        },
        required: ["command", "cwd", "operation_id", "provider_epoch"], additionalProperties: false,
        "x-codex-operation-id": true, "x-codex-provider-epoch": providerEpoch,
        "x-codex-operation-status": {
          status_tool: "windows_command_result",
          operation_id_argument: "job_id",
          provider_epoch_argument: "provider_epoch",
          wait_seconds_argument: "wait_seconds",
          effect_scope: "tracked_process",
        },
      },
    }, {
      name: "windows_command_result", namespace: "mcp__windows_local", description: "Read command status.",
      parameters: {
        type: "object",
        properties: { job_id: { type: "string" }, provider_epoch: { type: "string" }, wait_seconds: { type: "integer" } },
        required: ["job_id", "provider_epoch"], "x-codex-read-only": true,
      },
    }],
  };
  const identity = {
    threadId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222",
  };

  try {
    const token = await broker.register(environment, 20_000, traceId, identity);
    const { bindingId } = await callTurnBroker<{ bindingId: string }>(broker.socketPath,
      { method: "claim", token });
    const pending = callTurnBroker<BrokerToolResult>(broker.socketPath, {
      method: "invoke", bindingId, wireName: "mcp__windows_local__windows_command",
      arguments: { command: "Get-Date", cwd: root },
    }, 15_000);
    const [delivered] = await broker.nextToolBatch(token);
    expect(delivered?.providerEpoch).toBe(providerEpoch);
    expect(delivered?.operationStatus).toEqual({
      statusTool: "mcp__windows_local__windows_command_result",
      operationIdArgument: "job_id",
      providerEpochArgument: "provider_epoch",
      waitSecondsArgument: "wait_seconds",
      effectScope: "tracked_process",
    });
    expect(delivered?.arguments).toEqual({ command: "Get-Date", cwd: root });
    expect(evidenceFiles(directory).every(entry => entry.providerEpoch === providerEpoch)).toBe(true);
    expect(evidenceFiles(directory).every(entry => JSON.stringify(entry.operationStatus) === JSON.stringify(delivered?.operationStatus))).toBe(true);

    broker.completeTool(token, delivered!.callId, result);
    expect(await pending).toEqual(result);
    expect(evidenceFiles(directory).every(entry => entry.providerEpoch === providerEpoch)).toBe(true);
    expect(JSON.stringify(evidenceFiles(directory))).not.toContain("Get-Date");
  } finally {
    await broker.close();
  }
});
test("duplicate event acknowledgement rejects tampered flags, timestamps, and unexpected fields", () => {
  const { directory } = fixture();
  const first = recordBrokerCallEvent({ directory, traceId, callId,
    wireName: "mutating_tool", event: "queued", now: new Date("2026-11-10T10:00:00.000Z") });
  const original = readFileSync(first.path, "utf8");
  const retry = () => recordBrokerCallEvent({ directory, traceId, callId,
    wireName: "mutating_tool", event: "queued" });
  const altered = [
    { replayAuthorized: true },
    { resultRecoverable: true },
    { recordedAt: "2026-02-31T10:00:00.000Z" },
    { recordedAt: "not-a-date" },
    { extra: "unexpected" },
  ];
  for (const change of altered) {
    writeFileSync(first.path, JSON.stringify({ ...JSON.parse(original), ...change }));
    expect(retry).toThrow("Conflicting broker call journal event");
  }
  writeFileSync(first.path, "{invalid");
  expect(retry).toThrow("Conflicting broker call journal event");
  writeFileSync(first.path, original);
  expect(retry()).toEqual({ path: first.path, recorded: false });
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

test("startup broker fences earlier native MCP calls but ignores calls made by its live process", async () => {
  const { root, directory } = fixture();
  const identity = { threadId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222" };
  const digest = nativeBrokerOwnerDigest(identity)!;
  const oldCall = `call_${"C".repeat(32)}`;
  recordBrokerCallEvent({ directory, traceId, callId: oldCall, wireName: "mutating_tool",
    event: "queued", nativeOwnerDigest: digest });
  recordBrokerCallEvent({ directory, traceId, callId: oldCall, wireName: "mutating_tool",
    event: "delivery_possible", nativeOwnerDigest: digest });

  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "startup-socket")));
  try {
    broker.enableCallJournal(directory);
    expect(broker.priorNativeCallStates(traceId, identity)).toEqual(["delivery_unknown"]);
    expect(broker.priorNativeCallStates("000000000000", identity)).toEqual(["delivery_unknown"]);
    expect(broker.priorNativeCallStates("000000000000",
      { ...identity, turnId: "33333333-3333-4333-8333-333333333333" })).toEqual([]);
    expect(() => broker.priorNativeCallStates(traceId,
      { ...identity, turnId: "33333333-3333-4333-8333-333333333333" }))
      .toThrow("ownership cannot be authenticated");
    expect(() => broker.priorNativeCallStates(traceId, { threadId: identity.threadId }))
      .toThrow("ownership cannot be authenticated");

    const liveCall = `call_${"D".repeat(32)}`;
    recordBrokerCallEvent({ directory, traceId: "000000000001", callId: liveCall,
      wireName: "read_tool", event: "queued", nativeOwnerDigest: digest });
    expect(broker.priorNativeCallStates("000000000001", identity)).toEqual(["delivery_unknown"]);
    expect(broker.priorNativeCallStates(traceId, identity)).toEqual(["delivery_unknown"]);
  } finally {
    await broker.close();
  }
});

test("legacy call ownership remains ambiguous across changed diagnostic traces", async () => {
  const { root, directory } = fixture();
  const identity = { threadId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222" };
  recordBrokerCallEvent({ directory, traceId, callId, wireName: "legacy_mutation", event: "queued" });
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "legacy-fence")));
  try {
    broker.enableCallJournal(directory);
    expect(() => broker.priorNativeCallStates("abcdef123456", identity))
      .toThrow("ownership cannot be authenticated");
    await expect(broker.register({ cwd: root, roots: [root], writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" }, tools: [] }, 20_000,
    "abcdef123456", identity)).rejects.toThrow("ownership cannot be authenticated");
  } finally {
    await broker.close();
  }
});

test("registration fences earlier native calls at direct, IPC, and Zero Risk broker boundaries", async () => {
  const { root, directory } = fixture();
  const identity = { threadId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222" };
  const earlierTrace = traceId;
  const changedTrace = "abcdef123456";
  recordBrokerCallEvent({ directory, traceId: earlierTrace,
    callId: `call_${"E".repeat(32)}`, wireName: "mutating_tool", event: "queued",
    nativeOwnerDigest: nativeBrokerOwnerDigest(identity) });
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "registration-fence")));
  const remote = new RemoteTurnBroker(broker.socketPath);
  const environment = { cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const }, tools: [] };
  const nonce = "A".repeat(32);
  try {
    broker.enableCallJournal(directory);
    await expect(broker.register(environment, 20_000, earlierTrace, identity))
      .rejects.toThrow("require reconciliation");
    await expect(remote.register(environment, 20_000, changedTrace, identity))
      .rejects.toThrow("require reconciliation");
    await expect(broker.registerSafe(environment, nonce, 20_000, earlierTrace, identity))
      .rejects.toThrow("require reconciliation");
    await expect(remote.registerSafe(environment, nonce, 20_000, changedTrace, identity))
      .rejects.toThrow("require reconciliation");
    await expect(remote.register(environment, 20_000, earlierTrace))
      .rejects.toThrow("ownership cannot be authenticated");
    await expect(remote.register(environment, 20_000, changedTrace))
      .rejects.toThrow("ownership cannot be authenticated");
    await expect(broker.register(environment, 20_000, earlierTrace,
      { ...identity, turnId: "33333333-3333-4333-8333-333333333333" }))
      .rejects.toThrow("ownership cannot be authenticated");
    const next = { ...identity, turnId: "33333333-3333-4333-8333-333333333333" };
    const token = await remote.register(environment, 20_000, changedTrace, next);
    expect(token).toStartWith("turn_");
    await remote.revoke(token);
  } finally {
    await broker.close();
  }
});

test("live broker refuses duplicate native owners and re-registration after a queued call", async () => {
  const { root, directory } = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "live-owner-fence")));
  const remote = new RemoteTurnBroker(broker.socketPath);
  const environment = { cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const }, tools: [] };
  const identity = { threadId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222" };
  try {
    broker.enableCallJournal(directory);
    const token = await broker.register(environment, 20_000, traceId, identity);
    await expect(remote.register(environment, 20_000, "abcdef123456", identity))
      .rejects.toThrow("already owns");
    const { bindingId } = await callTurnBroker<{ bindingId: string }>(broker.socketPath,
      { method: "claim", token });
    const pending = callTurnBroker<BrokerToolResult>(broker.socketPath,
      { method: "invoke", bindingId, wireName: "read_tool", arguments: {} }, 15_000);
    const [call] = await broker.nextToolBatch(token);
    expect(call).toBeDefined();
    broker.completeTool(token, call!.callId, result);
    await pending;
    broker.revoke(token);
    await expect(remote.register(environment, 20_000, "abcdef123456", identity))
      .rejects.toThrow("previously queued");
    await expect(remote.register(environment, 20_000, "abcdef123456"))
      .rejects.toThrow("ownership cannot be authenticated");
    const freshIdentity = { ...identity, turnId: "33333333-3333-4333-8333-333333333333" };
    const freshToken = await remote.register(environment, 20_000, "abcdef123456", freshIdentity);
    await remote.revoke(freshToken);
  } finally {
    await broker.close();
  }
});

test("startup broker fences unfinished journal publication before any owner registration", async () => {
  const { root, directory } = fixture();
  const pendingDirectory = join(directory, traceId);
  mkdirSync(pendingDirectory, { recursive: true });
  const pendingPath = join(pendingDirectory,
    `.${"a".repeat(64)}.${"b".repeat(24)}.pending`);
  writeFileSync(pendingPath, "{unfinished");
  // The diagnostic reader may show confirmed calls without treating this as an event.
  expect(inspectBrokerCallJournal(directory)).toEqual([]);

  const environment = { cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const }, tools: [] };
  const identity = { threadId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222" };
  const changedTrace = "abcdef123456";
  const nonce = "A".repeat(32);
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "unfinished-journal")));
  const remote = new RemoteTurnBroker(broker.socketPath);
  try {
    broker.enableCallJournal(directory);
    expect(() => broker.priorNativeCallStates(changedTrace, identity))
      .toThrow("invalid or unreadable");
    await expect(broker.register(environment, 20_000, changedTrace, identity))
      .rejects.toThrow("invalid or unreadable");
    await expect(remote.register(environment, 20_000, changedTrace, identity))
      .rejects.toThrow("invalid or unreadable");
    await expect(broker.registerSafe(environment, nonce, 20_000, changedTrace, identity))
      .rejects.toThrow("invalid or unreadable");
    await expect(remote.registerSafe(environment, nonce, 20_000, changedTrace, identity))
      .rejects.toThrow("invalid or unreadable");
    expect(existsSync(pendingPath)).toBe(true);
  } finally {
    await broker.close();
  }

  // Once the publication is independently investigated and removed, a new broker
  // may admit a fresh owner with no surviving call evidence.
  rmSync(pendingPath);
  const restarted = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "restarted-journal")));
  try {
    restarted.enableCallJournal(directory);
    const token = await restarted.register(environment, 20_000, changedTrace, identity);
    expect(token).toStartWith("turn_");
    restarted.revoke(token);
  } finally {
    await restarted.close();
  }
});

test("startup broker refuses a corrupt journal before creating any new browser owner", async () => {
  const { root, directory } = fixture();
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "unexpected.txt"), "unexpected");
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "invalid-socket")));
  try {
    broker.enableCallJournal(directory);
    expect(() => broker.priorNativeCallStates(traceId, {
      threadId: "11111111-1111-4111-8111-111111111111",
      turnId: "22222222-2222-4222-8222-222222222222",
    })).toThrow("invalid or unreadable");
    const environment = { cwd: root, roots: [root], writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" as const }, tools: [] };
    await expect(broker.register(environment, 20_000, traceId))
      .rejects.toThrow("invalid or unreadable");
    await expect(new RemoteTurnBroker(broker.socketPath).registerSafe(
      environment, "A".repeat(32), 20_000, traceId))
      .rejects.toThrow("invalid or unreadable");
  } finally {
    await broker.close();
  }
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
    const vault = new BrokerResultVault(vaultDirectoryForJournal(directory));
    const restored = { traceId, callId: callIds[0]!, tool: "test_tool",
      nativeOwnerDigest: digestOf(firstIdentity) };
    if (process.platform === "win32" || process.env.CODEX_INFINITY_RESULT_VAULT_KEY) {
      expect(vault.read(restored)).toEqual(result);
      expect(() => vault.read({ ...restored, nativeOwnerDigest: digestOf(secondIdentity) }))
        .toThrow("identity mismatch");
      expect(readFileSync(sealedPath(directory, traceId, callIds[0]!), "utf8"))
        .not.toContain("private tool output");
    }
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

test("encrypted results persist across vault instances, reject conflicting receipts and fail closed on tampering", () => {
  const { directory } = fixture();
  const priorKey = process.env.CODEX_INFINITY_RESULT_VAULT_KEY;
  if (process.platform !== "win32") process.env.CODEX_INFINITY_RESULT_VAULT_KEY = "ab".repeat(32);
  try {
    const identity = { traceId, callId, tool: "test_tool", nativeOwnerDigest: "b".repeat(64) };
    const vault = new BrokerResultVault(vaultDirectoryForJournal(directory));
    vault.seal(identity, result);
    const restored = new BrokerResultVault(vaultDirectoryForJournal(directory));
    expect(restored.read(identity)).toEqual(result);
    expect(restored.read({ nativeOwnerDigest: identity.nativeOwnerDigest, tool: identity.tool,
      callId: identity.callId, traceId: identity.traceId })).toEqual(result);
    expect(readFileSync(sealedPath(directory, traceId, callId), "utf8"))
      .not.toContain("private tool output");
    restored.seal(identity, structuredClone(result));
    expect(() => restored.seal(identity, { content: [{ type: "text", text: "different" }] }))
      .toThrow("Conflicting durable broker tool result");
    expect(() => restored.read({ ...identity, nativeOwnerDigest: "a".repeat(64) }))
      .toThrow("identity mismatch");
    const path = sealedPath(directory, traceId, callId);
    const original = readFileSync(path, "utf8");
    const record = JSON.parse(original) as { ciphertext: string };
    record.ciphertext = `${record.ciphertext[0] === "A" ? "B" : "A"}${record.ciphertext.slice(1)}`;
    writeFileSync(path, JSON.stringify(record));
    expect(() => new BrokerResultVault(vaultDirectoryForJournal(directory)).read(identity))
      .toThrow("authentication or payload validation failed");
    writeFileSync(path, original);
    expect(restored.read(identity)).toEqual(result);
    writeFileSync(path, "null");
    expect(() => new BrokerResultVault(vaultDirectoryForJournal(directory)).read(identity))
      .toThrow("identity mismatch or invalid envelope");
    writeFileSync(path, original);
    const nonCanonical = JSON.parse(original) as { ciphertext: string };
    nonCanonical.ciphertext += "\n";
    writeFileSync(path, JSON.stringify(nonCanonical));
    expect(() => restored.read(identity)).toThrow("authentication or payload validation failed");
    writeFileSync(path, original);
    if (process.platform !== "win32") {
      process.env.CODEX_INFINITY_RESULT_VAULT_KEY = "cd".repeat(32);
      expect(() => new BrokerResultVault(vaultDirectoryForJournal(directory)).read(identity))
        .toThrow("authentication or payload validation failed");
      process.env.CODEX_INFINITY_RESULT_VAULT_KEY = "ab".repeat(32);
    }
  } finally {
    if (priorKey === undefined) delete process.env.CODEX_INFINITY_RESULT_VAULT_KEY;
    else process.env.CODEX_INFINITY_RESULT_VAULT_KEY = priorKey;
  }
});

test("result vault rejects oversized bodies and malformed identities before publication", () => {
  const { directory } = fixture();
  const identity = { traceId, callId, tool: "test_tool", nativeOwnerDigest: "b".repeat(64) };
  const vault = new BrokerResultVault(vaultDirectoryForJournal(directory));
  expect(() => vault.seal({ ...identity, nativeOwnerDigest: "INVALID" }, result))
    .toThrow("Invalid broker result identity");
  expect(() => vault.seal(identity, { content: [{ type: "text", text: "x".repeat(64 * 1024 * 1024) }] }))
    .toThrow("exceeds the durable result limit");
  expect(existsSync(sealedPath(directory, traceId, callId))).toBe(false);
});

test("sealed result survives a failed result journal boundary and the exact owner retries", async () => {
  if (process.platform !== "win32" && !process.env.CODEX_INFINITY_RESULT_VAULT_KEY) return;
  const { root, directory } = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "socket")));
  broker.enableCallJournal(directory);
  const identity = { threadId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222" };
  const owner = createHash("sha256")
    .update(JSON.stringify([identity.threadId, identity.turnId])).digest("hex");
  const token = await broker.register({ cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" }, tools: [] }, 20_000, traceId, identity);
  const { bindingId } = await callTurnBroker<{ bindingId: string }>(broker.socketPath, { method: "claim", token });
  try {
    const pending = callTurnBroker<BrokerToolResult>(broker.socketPath,
      { method: "invoke", bindingId, wireName: "mutating_tool" }, 15_000);
    const [delivered] = await broker.nextToolBatch(token);
    const journalPath = eventPath(directory, traceId, delivered!.callId, "result_received");
    mkdirSync(journalPath, { recursive: true });
    expect(() => broker.completeTool(token, delivered!.callId, result)).toThrow();
    expect(new BrokerResultVault(vaultDirectoryForJournal(directory)).read({
      traceId, callId: delivered!.callId, tool: "mutating_tool", nativeOwnerDigest: owner,
    })).toEqual(result);
    rmSync(journalPath, { recursive: true });
    expect(inspectBrokerCallJournal(directory)[0]?.state).toBe("delivery_unknown");
    broker.completeTool(token, delivered!.callId, result);
    expect(await pending).toEqual(result);
    expect(inspectBrokerCallJournal(directory)[0]?.state).toBe("result_unavailable");
  } finally { await broker.close(); }
});

test("failed encrypted publication leaves native invocation pending until the same owner retries", async () => {
  if (process.platform !== "win32" && !process.env.CODEX_INFINITY_RESULT_VAULT_KEY) return;
  const { root, directory } = fixture();
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "socket")));
  broker.enableCallJournal(directory);
  const identity = { threadId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222" };
  const owner = createHash("sha256")
    .update(JSON.stringify([identity.threadId, identity.turnId])).digest("hex");
  const token = await broker.register({ cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" }, tools: [] }, 20_000, traceId, identity);
  const { bindingId } = await callTurnBroker<{ bindingId: string }>(broker.socketPath, { method: "claim", token });
  try {
    const pending = callTurnBroker<BrokerToolResult>(broker.socketPath,
      { method: "invoke", bindingId, wireName: "mutating_tool" }, 15_000);
    const [delivered] = await broker.nextToolBatch(token);
    const path = sealedPath(directory, traceId, delivered!.callId);
    mkdirSync(path, { recursive: true });
    expect(() => broker.completeTool(token, delivered!.callId, result)).toThrow();
    expect(inspectBrokerCallJournal(directory)[0]?.state).toBe("delivery_unknown");
    expect((await broker.nextToolBatch(token))[0]!.callId).toBe(delivered!.callId);
    rmSync(path, { recursive: true });
    broker.completeTool(token, delivered!.callId, result);
    expect(await pending).toEqual(result);
    expect(new BrokerResultVault(vaultDirectoryForJournal(directory)).read({
      traceId, callId: delivered!.callId, tool: "mutating_tool", nativeOwnerDigest: owner,
    })).toEqual(result);
    expect(inspectBrokerCallJournal(directory)[0]?.state).toBe("result_unavailable");
  } finally { await broker.close(); }
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
  recordBrokerCallEvent({ directory, traceId, callId, wireName: "test_tool", event: "queued",
    now: new Date("2026-11-10T10:00:00.000Z") });
  const path = eventPath(directory, traceId, callId, "queued");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace('"replayAuthorized":false', '"replayAuthorized":true'));
  expect(() => inspectBrokerCallJournal(directory)).toThrow("invalid or inconsistent evidence");
  writeFileSync(path, original);
  // A syntactically valid timestamp must also represent that exact UTC instant.
  writeFileSync(path, original.replace(/"recordedAt":"[^"]+"/, '"recordedAt":"2026-02-31T10:00:00.000Z"'));
  expect(() => inspectBrokerCallJournal(directory)).toThrow("invalid or inconsistent evidence");
  writeFileSync(path, original);
  recordBrokerCallEvent({ directory, traceId, callId, wireName: "test_tool", event: "result_received",
    now: new Date("2026-11-10T10:00:02.000Z") });
  expect(() => inspectBrokerCallJournal(directory)).toThrow("invalid or inconsistent evidence");
  // A late journal publication retains the time at which delivery became possible.
  recordBrokerCallEvent({ directory, traceId, callId, wireName: "test_tool", event: "delivery_possible",
    now: new Date("2026-11-10T10:00:01.000Z") });
  expect(inspectBrokerCallJournal(directory)).toHaveLength(1);
  writeFileSync(join(directory, traceId, "0".repeat(64) + ".json"), "{broken");
  expect(() => inspectBrokerCallJournal(directory)).toThrow("invalid or inconsistent evidence");
});

test("reconciliation rejects chronologically reversed MCP event boundaries", () => {
  const earlier = "2026-11-10T10:00:00.000Z";
  const later = "2026-11-10T10:00:01.000Z";
  const scenarios = [
    [["queued", later], ["delivery_possible", earlier]],
    [["queued", earlier], ["delivery_possible", later], ["result_received", earlier]],
    [["queued", later], ["compaction_resolution_possible", earlier]],
    [["queued", earlier], ["delivery_possible", later], ["retired_uncertain", earlier]],
    [["queued", earlier], ["compaction_resolution_possible", later], ["retired_uncertain", earlier]],
  ] as const;

  for (const events of scenarios) {
    const { directory } = fixture();
    for (const [event, recordedAt] of events) {
      recordBrokerCallEvent({ directory, traceId, callId, wireName: "test_tool", event,
        now: new Date(recordedAt) });
    }
    expect(() => inspectBrokerCallJournal(directory)).toThrow("invalid or inconsistent evidence");
  }

  const { directory } = fixture();
  for (const event of ["queued", "delivery_possible", "result_received"] as const) {
    recordBrokerCallEvent({ directory, traceId, callId, wireName: "test_tool", event,
      now: new Date(earlier) });
  }
  expect(inspectBrokerCallJournal(directory)[0]?.state).toBe("result_unavailable");
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
