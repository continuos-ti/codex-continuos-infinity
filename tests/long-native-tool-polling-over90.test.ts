import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TurnBroker, type BrokerToolResult } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";
import { CHATGPT_NATIVE_DEFER_AFTER_MS, CHATGPT_NATIVE_PENDING_WIRE_NAME } from "../src/adapters/chatgpt-web/mcp-server";
import { socketFixtureRoot } from "./support/socket-fixture-root";

test("a slow native tool returns a polling receipt, executes once and delivers its original result", async () => {
  expect(CHATGPT_NATIVE_DEFER_AFTER_MS).toBeLessThan(60_000);
  const root = socketFixtureRoot("cgw-deferred-native-");
  const socket = defaultBrokerEndpoint(join(root, "broker"));
  const broker = TurnBroker.forSocket(socket);
  const environment = {
    cwd: root,
    roots: [root],
    writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const },
    tools: [
      { name: "slow_tool", description: "a native, slow, exactly-once tool", parameters: { type: "object" } },
    ],
  };
  const token = await broker.register(environment, 180_000);
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["src/cli.ts", "mcp", "--broker-socket", socket],
    cwd: process.cwd(), stderr: "pipe",
  });
  const client = new Client({name: "cgw-deferred-test", version: "1.0.0"});
  let provider: ReturnType<typeof spawn> | undefined;
  try {
    await client.connect(transport);
    const request = client.callTool({
      name: "codex_tool_call",
      arguments: { turn_token: token, wire_name: "slow_tool", arguments: { value: 19 } },
    });
    const [native] = await broker.nextToolBatch(token);
    expect(native).toMatchObject({ wireName: "slow_tool", arguments: { value: 19 } });
    const markerPath = join(root, "provider-executions.txt");
    const providerStartedAt = Date.now();
    const providerValue = String(native!.arguments?.value ?? "");
    const providerCommand = process.platform === "win32"
      ? {
          command: "powershell.exe",
          args: ["-NoProfile", "-NonInteractive", "-Command", `Start-Sleep -Seconds 105; [System.IO.File]::AppendAllText('${markerPath.replace(/'/g, "''")}', 'completed:${providerValue}' + [Environment]::NewLine); exit 0`],
        }
      : {
          command: "sh",
          args: ["-c", 'sleep 105; printf "%s\n" "$2" >> "$1"', "infinity-provider", markerPath, `completed:${providerValue}`],
        };
    provider = spawn(providerCommand.command, providerCommand.args, { stdio: "ignore", windowsHide: true });
    const providerExit = new Promise<{ code: number | null; error?: Error }>(resolve => {
      provider!.once("error", error => resolve({ code: null, error }));
      provider!.once("close", code => resolve({ code }));
    });
    const pending = await request;
    expect(pending.structuredContent).toMatchObject({ code: "codex_tool_in_progress" });
    const jobId = (pending.structuredContent as {job_id: string}).job_id;
    expect(jobId).toMatch(/^native_[A-Za-z0-9_-]{24}$/);
    const earlyPoll = await client.callTool({
      name: "codex_tool_call",
      arguments: { turn_token: token, wire_name: CHATGPT_NATIVE_PENDING_WIRE_NAME, arguments: { job_id: jobId } },
    });
    expect(earlyPoll.structuredContent).toMatchObject({ code: "codex_tool_in_progress" });
    // The real child process runs across the initial defer and repeated result polling.
    const providerResult = await providerExit;
    if (providerResult.error) throw providerResult.error;
    const providerExitCode = providerResult.code ?? -1;
    const providerElapsedMs = Date.now() - providerStartedAt;
    expect(providerExitCode).toBe(0);
    expect(providerElapsedMs).toBeGreaterThan(90_000);
    expect(readFileSync(markerPath, "utf8").trim().split(/\r?\n/)).toEqual([`completed:${providerValue}`]);
    const poll = client.callTool({
      name: "codex_tool_call",
      arguments: { turn_token: token, wire_name: CHATGPT_NATIVE_PENDING_WIRE_NAME, arguments: { job_id: jobId } },
    });
    const outcome: BrokerToolResult = { content: [{type: "text", text: "native result"}], structuredContent: { confirmed: 19, provider_exit_code: providerExitCode, provider_elapsed_ms: providerElapsedMs, provider_executions: 1 } };
    broker.completeTool(token, native!.callId, outcome);
    const retrieved = await poll;
    expect(retrieved.structuredContent).toEqual({ confirmed: 19, provider_exit_code: 0, provider_elapsed_ms: providerElapsedMs, provider_executions: 1 });
    expect(retrieved.isError).not.toBe(true);
    const lost = await client.callTool({
      name: "codex_tool_call",
      arguments: { turn_token: token, wire_name: CHATGPT_NATIVE_PENDING_WIRE_NAME, arguments: { job_id: jobId } },
    });
    expect(lost.isError).toBe(true);
    expect(lost.structuredContent).toMatchObject({ code: "codex_pending_result_unavailable" });
    // The broker never received a duplicate slow_tool invocation.
    expect(native!.wireName).toBe("slow_tool");
  } finally {
    if (provider && provider.exitCode === null && provider.signalCode === null) provider.kill();
    await client.close().catch(() => {});
    await broker.close();
    rmSync(root, {force: true, recursive: true});
  }
}, 150_000);
