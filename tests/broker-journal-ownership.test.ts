import { expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { defaultBrokerEndpoint } from "../src/config";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
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
    expect(() => parent.enableCallJournal(directory)).toThrow("already owned by another process");

    child.kill();
    await child.exited;
    parent.enableCallJournal(directory);
    expect(parent.priorNativeCallStates("123456abcdef", {
      threadId: "11111111-1111-4111-8111-111111111111",
      turnId: "22222222-2222-4222-8222-222222222222",
    })).toEqual(["delivery_unknown"]);
    expect(() => parent.priorNativeCallStates("123456abcdef", {
      threadId: "11111111-1111-4111-8111-111111111111",
      turnId: "33333333-3333-4333-8333-333333333333",
    })).toThrow("ownership cannot be authenticated");
    await parent.listen();
  } finally {
    if (child.exitCode === null) child.kill();
    await child.exited;
    await parent.close();
    rmSync(root, { recursive: true, force: true });
  }
});
