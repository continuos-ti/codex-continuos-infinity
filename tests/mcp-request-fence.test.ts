import { expect, test } from "bun:test";
import { McpRequestFence } from "../src/adapters/chatgpt-web/mcp-request-fence";

test("concurrent and completed duplicate JSON-RPC requests reuse one native operation", async () => {
  const fence = new McpRequestFence();
  const request = { requestId: 12 };
  const input = { turn_token: "secret-turn", command: "write private.txt", arguments: { b: 2, a: 1 } };
  let dispatches = 0;
  let resolveOperation!: (value: string) => void;
  const operation = new Promise<string>(resolve => { resolveOperation = resolve; });
  const invoke = () => { dispatches += 1; return operation; };
  const first = fence.run(request, "codex_exec", input, invoke);
  const duplicate = fence.run(request, "codex_exec", {
    arguments: { a: 1, b: 2 }, command: "write private.txt", turn_token: "secret-turn",
  }, invoke);
  await Promise.resolve();
  expect(dispatches).toBe(1);
  resolveOperation("native-result");
  expect(await Promise.all([first, duplicate])).toEqual(["native-result", "native-result"]);
  expect(await fence.run(request, "codex_exec", input, invoke)).toBe("native-result");
  expect(dispatches).toBe(1);
});

test("legitimate identical calls with distinct IDs remain independent across sessions", async () => {
  const fence = new McpRequestFence();
  let dispatches = 0;
  const invoke = () => ++dispatches;
  const input = { turn_token: "same-turn", args: { x: 1 } };
  expect(await fence.run({ requestId: 42 }, "codex_tool_call", input, invoke)).toBe(1);
  expect(await fence.run({ requestId: 43 }, "codex_tool_call", input, invoke)).toBe(2);
  expect(await fence.run({ sessionId: "other-session", requestId: 42 }, "codex_tool_call", input, invoke)).toBe(3);
  expect(dispatches).toBe(3);
});

test("reused protocol IDs with changed arguments, tools or turn capabilities fail closed", async () => {
  const fence = new McpRequestFence();
  const identity = { sessionId: "connected-session", requestId: "rpc-7" };
  let dispatches = 0;
  const invoke = () => ++dispatches;
  expect(await fence.run(identity, "codex_exec", { token: "turn-one", cmd: "echo safe" }, invoke)).toBe(1);
  for (const [tool, input] of [
    ["codex_exec", { token: "turn-one", cmd: "echo changed" }],
    ["codex_exec", { token: "turn-two", cmd: "echo safe" }],
    ["codex_apply_patch", { token: "turn-one", cmd: "echo safe" }],
  ] as const) {
    expect(fence.run(identity, tool, input, invoke)).rejects.toThrow("reused for a different tool or arguments");
  }
  expect(dispatches).toBe(1);
});

test("failed invocations remain fenced, expired outcomes become tombstones, and saturation refuses new effects", async () => {
  const fence = new McpRequestFence(2, 10);
  let dispatches = 0;
  const failed = () => { dispatches += 1; throw new Error("private error"); };
  await expect(fence.run({ requestId: 1 }, "codex_tool_call", { private: "secret" }, failed))
    .rejects.toThrow("private error");
  await expect(fence.run({ requestId: 1 }, "codex_tool_call", { private: "secret" }, failed))
    .rejects.toThrow("private error");
  expect(dispatches).toBe(1);
  expect(await fence.run({ requestId: 2 }, "codex_tool_call", {}, () => ++dispatches)).toBe(2);
  await Bun.sleep(30);
  await expect(fence.run({ requestId: 1 }, "codex_tool_call", { private: "secret" }, failed))
    .rejects.toThrow("result expired");
  await expect(fence.run({ requestId: 3 }, "codex_tool_call", {}, () => ++dispatches))
    .rejects.toThrow("session limit");
  expect(dispatches).toBe(2);
  expect(JSON.stringify(fence)).not.toContain("secret");
});
