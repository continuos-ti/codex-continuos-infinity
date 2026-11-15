import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultBrokerEndpoint } from "../src/config";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { inspectSettledBrokerCallJournal, readAuthenticatedBrokerRecoverySnapshot } from "../src/adapters/chatgpt-web/broker-call-reconciliation";
import { nativeBrokerOwnerDigest } from "../src/adapters/chatgpt-web/native-broker-owner";
import { BrokerResultVault, vaultDirectoryForJournal } from "../src/adapters/chatgpt-web/sealed-broker-results";
import { socketFixtureRoot } from "./support/socket-fixture-root";

test("brokers with different sockets cannot share one call journal, including after listening", async () => {
  const root = socketFixtureRoot("infinity-journal-owner-");
  const directory = join(root, "diagnostics", "broker-calls");
  const first = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "first")));
  const second = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "second")));
  try {
    first.enableCallJournal(directory);
    await first.listen();
    expect(() => second.enableCallJournal(directory)).toThrow("already owned by another process");
    await first.close();
    second.enableCallJournal(directory);
    await second.listen();
    expect(() => second.enableCallJournal(join(root, "other-journal")))
      .toThrow("cannot be enabled or changed");
  } finally {
    await first.close();
    await second.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a journal directory alias cannot acquire a second writer lock", async () => {
  const root = socketFixtureRoot("infinity-journal-alias-");
  const directory = join(root, "diagnostics", "broker-calls");
  const alias = join(root, "broker-calls-alias");
  const first = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "canonical")));
  const second = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "alias")));
  try {
    mkdirSync(directory, { recursive: true });
    symlinkSync(directory, alias, process.platform === "win32" ? "junction" : "dir");
    first.enableCallJournal(directory);
    expect(() => second.enableCallJournal(alias)).toThrow("already owned by another process");
    await first.close();
    second.enableCallJournal(alias);
    await second.listen();
  } finally {
    await first.close();
    await second.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("closing during broker startup releases journal ownership only after startup settles", async () => {
  const root = socketFixtureRoot("infinity-journal-start-close-");
  const directory = join(root, "diagnostics", "broker-calls");
  const first = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "first")));
  const successor = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "successor")));
  try {
    first.enableCallJournal(directory);
    const starting = first.listen();
    const closing = first.close();
    await Promise.allSettled([starting, closing]);
    expect(() => first.enableCallJournal(directory)).toThrow("closed broker");
    await expect(first.register({
      cwd: root, roots: [root], writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" }, tools: [],
    })).rejects.toThrow("has closed");
    successor.enableCallJournal(directory);
    await successor.listen();
  } finally {
    await first.close();
    await successor.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a crashed broker releases its cross-process journal lock and preserves the native replay fence", async () => {
  const root = socketFixtureRoot("infinity-journal-crash-");
  const directory = join(root, "diagnostics", "broker-calls");
  const readyPath = join(root, "child-ready");
  const childSocket = defaultBrokerEndpoint(join(root, "child"));
  const parentSocket = defaultBrokerEndpoint(join(root, "parent"));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "broker-journal-owner.ts"),
    childSocket, directory, readyPath], { stdout: "ignore", stderr: "pipe" });
  const parent = TurnBroker.forSocket(parentSocket);
  try {
    for (let attempt = 0; attempt < 160 && !existsSync(readyPath); attempt++) {
      if (child.exitCode !== null) throw new Error(`Broker fixture terminated: ${child.exitCode}`);
      await Bun.sleep(25);
    }
    expect(existsSync(readyPath)).toBe(true);
    const deliveredId = readFileSync(readyPath, "utf8");
    expect(deliveredId).toMatch(/^call_[A-Za-z0-9_-]{32}$/);
    expect(() => parent.enableCallJournal(directory)).toThrow("already owned by another process");

    child.kill();
    await child.exited;
    parent.enableCallJournal(directory);
    const records = inspectSettledBrokerCallJournal(directory);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      callId: deliveredId, tool: "mutating_tool", state: "delivery_unknown", replayAuthorized: false,
    });
    expect(JSON.stringify(records)).not.toContain("never-journal");
    expect(parent.priorNativeCallStates("123456abcdef", {
      threadId: "11111111-1111-4111-8111-111111111111",
      turnId: "22222222-2222-4222-8222-222222222222",
    })).toEqual(["delivery_unknown"]);
    expect(() => parent.priorNativeCallStates("123456abcdef", {
      threadId: "11111111-1111-4111-8111-111111111111",
      turnId: "33333333-3333-4333-8333-333333333333",
    })).toThrow("ownership cannot be authenticated");
    await parent.listen();
    await expect(parent.register({
      cwd: root, roots: [root], writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" }, tools: [],
    }, 20_000, "123456abcdef", {
      threadId: "11111111-1111-4111-8111-111111111111",
      turnId: "22222222-2222-4222-8222-222222222222",
    })).rejects.toThrow("reconciliation");
  } finally {
    if (child.exitCode === null) child.kill();
    await child.exited;
    await parent.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a crash after result delivery retains the sealed result across processes without granting replay", async () => {
  const root = socketFixtureRoot("infinity-result-crash-");
  const directory = join(root, "diagnostics", "broker-calls");
  const readyPath = join(root, "child-completed");
  // Linux and macOS use an explicit vault key. Give the child a private test key
  // without changing the environment of concurrent test files.
  const vaultKey = process.env.CODEX_INFINITY_RESULT_VAULT_KEY ?? randomBytes(32).toString("hex");
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "broker-journal-owner.ts"),
    defaultBrokerEndpoint(join(root, "child")), directory, readyPath, "completed"], {
    stdout: "ignore", stderr: "pipe",
    env: { ...process.env, CODEX_INFINITY_RESULT_VAULT_KEY: vaultKey },
  });
  const successor = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "successor")));
  const identity = {
    threadId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222",
  };
  try {
    for (let attempt = 0; attempt < 400 && !existsSync(readyPath); attempt++) {
      if (child.exitCode !== null) throw new Error(`Completed broker fixture terminated: ${child.exitCode}`);
      await Bun.sleep(25);
    }
    expect(existsSync(readyPath)).toBe(true);
    const deliveredId = readFileSync(readyPath, "utf8");
    expect(deliveredId).toMatch(/^call_[A-Za-z0-9_-]{32}$/);
    child.kill();
    await child.exited;

    successor.enableCallJournal(directory);
    const records = inspectSettledBrokerCallJournal(directory);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      traceId: "123456abcdef", callId: deliveredId, tool: "mutating_tool",
      state: "result_unavailable", replayAuthorized: false,
    });
    expect(JSON.stringify(records)).not.toContain("private-result-not-in-journal");
    const digest = nativeBrokerOwnerDigest(identity);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const priorKey = process.env.CODEX_INFINITY_RESULT_VAULT_KEY;
    let saved;
    try {
      process.env.CODEX_INFINITY_RESULT_VAULT_KEY = vaultKey;
      saved = new BrokerResultVault(vaultDirectoryForJournal(directory)).read({
        traceId: "123456abcdef", callId: deliveredId, tool: "mutating_tool",
        nativeOwnerDigest: digest!,
      });
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_INFINITY_RESULT_VAULT_KEY;
      else process.env.CODEX_INFINITY_RESULT_VAULT_KEY = priorKey;
    }
    expect(saved).toEqual({ content: [{ type: "text", text: "private-result-not-in-journal" }] });
    await expect(successor.register({
      cwd: root, roots: [root], writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" }, tools: [],
    }, 20_000, "123456abcdef", identity)).rejects.toThrow("reconciliation");
  } finally {
    if (child.exitCode === null) child.kill();
    await child.exited;
    await successor.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a crashed read-only broker rebinds its native turn only after the original output is verified", async () => {
  const root = socketFixtureRoot("infinity-readonly-crash-");
  const directory = join(root, "diagnostics", "broker-calls");
  const readyPath = join(root, "child-completed");
  const codexHome = join(root, "native-home");
  const cwd = dirname(directory);
  const identity = {
    threadId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222",
  };
  const vaultKey = process.env.CODEX_INFINITY_RESULT_VAULT_KEY ?? randomBytes(32).toString("hex");
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "broker-journal-owner.ts"),
    defaultBrokerEndpoint(join(root, "child")), directory, readyPath, "completed_readonly"], {
    stdout: "ignore", stderr: "pipe",
    env: { ...process.env, CODEX_INFINITY_RESULT_VAULT_KEY: vaultKey },
  });
  const successor = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "successor")));
  const environment = {
    cwd, roots: [cwd], writableRoots: [],
    sandboxPolicy: { type: "readOnly" as const, networkAccess: false }, tools: [],
  };

  try {
    for (let attempt = 0; attempt < 400 && !existsSync(readyPath); attempt++) {
      if (child.exitCode !== null) throw new Error(`Read-only broker fixture terminated: ${child.exitCode}`);
      await Bun.sleep(25);
    }
    expect(existsSync(readyPath)).toBe(true);
    const callId = readFileSync(readyPath, "utf8");
    expect(callId).toMatch(/^call_[A-Za-z0-9_-]{32}$/);
    child.kill();
    await child.exited;

    successor.enableCallJournal(directory);
    expect(inspectSettledBrokerCallJournal(directory)).toMatchObject([{
      callId, tool: "read_tool", readOnly: true, state: "result_unavailable",
    }]);
    await expect(successor.register(environment, 30_000, "123456abcdef", identity))
      .rejects.toThrow("reconciliation");

    const rollout = join(codexHome, "sessions", "2026", "11", "15",
      `rollout-2026-11-15T17-00-00-${identity.threadId}.jsonl`);
    mkdirSync(dirname(rollout), { recursive: true });
    writeFileSync(rollout, [
      { type: "session_meta", payload: { id: identity.threadId, source: "cli" } },
      { type: "turn_context", payload: { turn_id: identity.turnId, cwd,
        sandbox_policy: { type: "danger-full-access" }, permission_profile: { type: "disabled" } } },
      { type: "event_msg", payload: { type: "task_started", turn_id: identity.turnId } },
      { type: "response_item", payload: { type: "function_call", call_id: callId, name: "read_tool" } },
      { type: "response_item", payload: { type: "function_call_output", call_id: callId, output: "observed" } },
    ].map(entry => JSON.stringify(entry)).join("\n") + "\n");

    const previousKey = process.env.CODEX_INFINITY_RESULT_VAULT_KEY;
    let recovered;
    try {
      process.env.CODEX_INFINITY_RESULT_VAULT_KEY = vaultKey;
      recovered = readAuthenticatedBrokerRecoverySnapshot({
        codexHome, journalDirectory: directory,
        lineage: { threadId: identity.threadId, sandboxType: "dangerFullAccess", workspaceRoots: [cwd] },
        turnId: identity.turnId,
      });
    } finally {
      if (previousKey === undefined) delete process.env.CODEX_INFINITY_RESULT_VAULT_KEY;
      else process.env.CODEX_INFINITY_RESULT_VAULT_KEY = previousKey;
    }
    expect(recovered.status).toBe("verified_native_recovery_snapshot");
    if (recovered.status !== "verified_native_recovery_snapshot") return;
    expect(recovered.calls).toHaveLength(1);
    expect(recovered.calls[0]?.resultEvidence.status).toBe("verified_result_evidence");
    expect(recovered.calls[0]?.nativeOutputEvidence).toBe("recorded_in_native_rollout");
    const permit = successor.authorizeAuthenticatedReadOnlyRecovery(identity, recovered);
    expect(typeof permit).toBe("symbol");
    const token = await successor.registerAuthenticatedReadOnlyRecovery(
      environment, permit!, 30_000, "123456abcdef", identity,
    );
    expect(token).toMatch(/^turn_[A-Za-z0-9_-]{32}$/);
    await expect(successor.register(environment, 30_000, "123456abcdef", identity))
      .rejects.toThrow("reconciliation");
    successor.revoke(token);
  } finally {
    if (child.exitCode === null) child.kill();
    await child.exited;
    await successor.close();
    rmSync(root, { recursive: true, force: true });
  }
});
