import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CodexMessage, CodexTool } from "../src/types";
import type { BrokerRecoveryCall } from "../src/adapters/chatgpt-web/broker-call-reconciliation";
import { attachBrokerOperationId, brokerOperationStatusForTool } from "../src/adapters/chatgpt-web/broker-operation-identity";
import { observeBrokerProviderRecoveryChecks, prepareBrokerProviderRecoveryChecks } from "../src/adapters/chatgpt-web/broker-provider-recovery";

type JsonObject = Record<string, unknown>;
type ToolResult = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};
type ServerSession = {
  client: Client;
  transport: StdioClientTransport;
};

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function asCodexTools(tools: Array<{ name: string; description?: string; inputSchema: unknown }>): CodexTool[] {
  return tools.map(tool => ({
    namespace: "mcp__windows_local",
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.inputSchema as Record<string, unknown>,
  }));
}

function parseToolResult(result: unknown): JsonObject {
  const toolResult = result as ToolResult;
  const text = toolResult.content?.find((item) => item.type === "text")?.text;
  if (toolResult.isError) {
    throw new Error(`MCP tool returned an error: ${text ?? "unknown error"}`);
  }
  if (!text) {
    throw new Error("MCP tool returned no text content");
  }
  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    throw new Error(`MCP tool returned non-JSON content: ${text.slice(0, 300)}`);
  }
}

async function connectServer(
  name: string,
  pythonPath: string,
  serverPath: string,
  cwd: string,
  env: Record<string, string>,
): Promise<ServerSession> {
  const transport = new StdioClientTransport({
    command: pythonPath,
    args: ["-u", serverPath],
    cwd,
    env,
    stderr: "pipe",
  });
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

async function closeServer(session: ServerSession | undefined): Promise<void> {
  if (!session) return;
  await session.client.close().catch(() => {});
  await session.transport.close().catch(() => {});
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("This staging provider smoke test requires Windows.");
  }

  const repoRoot = resolve(import.meta.dir, "..");
  const sourceRoot = process.env.WINDOWS_LOCAL_SOURCE_ROOT ?? "H:\\Projetos\\windows-local";
  const pythonPath = process.env.WINDOWS_LOCAL_PYTHON ?? join(sourceRoot, ".venv", "Scripts", "python.exe");
  const commandDurationSeconds = Number(process.env.WINDOWS_LOCAL_STAGING_COMMAND_SECONDS ?? "20");
  if (!Number.isInteger(commandDurationSeconds) || commandDurationSeconds < 5 || commandDurationSeconds > 180) {
    throw new Error("WINDOWS_LOCAL_STAGING_COMMAND_SECONDS must be an integer from 5 to 180.");
  }
  const applyScript = join(repoRoot, "integrations", "windows-local", "apply-durable-command-jobs.ps1");
  const sourceServer = join(sourceRoot, "server.py");
  const sourceControl = join(sourceRoot, "windows_control.py");
  for (const path of [pythonPath, applyScript, sourceServer, sourceControl]) {
    if (!existsSync(path)) throw new Error(`Required staging input is missing: ${path}`);
  }

  const sourceHashes = {
    server: sha256(sourceServer),
    windowsControl: sha256(sourceControl),
  };
  const root = mkdtempSync(join(tmpdir(), "codex-infinity-windows-local-mcp-"));
  const stagingRoot = join(root, "provider");
  const stateDir = join(root, "state");
  const localAppData = join(root, "localappdata");
  const tempDir = join(root, "temp");
  const markerPath = join(root, "command-marker.txt");
  mkdirSync(stagingRoot, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  mkdirSync(tempDir, { recursive: true });

  let first: ServerSession | undefined;
  let second: ServerSession | undefined;
  let commandStarted = false;
  let commandCompleted = false;

  try {
    copyFileSync(sourceServer, join(stagingRoot, "server.py"));
    copyFileSync(sourceControl, join(stagingRoot, "windows_control.py"));

    const apply = spawnSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        applyScript,
        "-WindowsLocalRoot",
        stagingRoot,
        "-PythonPath",
        pythonPath,
        "-Apply",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (apply.status !== 0) {
      throw new Error(`Staging patch failed. stdout=${apply.stdout}\nstderr=${apply.stderr}`);
    }

    const serverEnv = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    Object.assign(serverEnv, {
      LOCALAPPDATA: localAppData,
      WINDOWS_LOCAL_REMOTE_STATE: stateDir,
      TEMP: tempDir,
      TMP: tempDir,
    });

    first = await connectServer(
      "windows-local-staging-before-restart",
      pythonPath,
      join(stagingRoot, "server.py"),
      stagingRoot,
      serverEnv,
    );
    const firstTools = (await first.client.listTools()).tools;
    const firstNames = firstTools.map((tool) => tool.name).sort();
    const codexTools = asCodexTools(firstTools);
    const commandWireName = "mcp__windows_local__windows_command";
    const statusContract = brokerOperationStatusForTool(commandWireName, codexTools);
    if (!statusContract || statusContract.effectScope !== "tracked_process") {
      throw new Error("The real staging tool schema cannot establish a broker status contract.");
    }
    const commandTool = firstTools.find((tool) => tool.name === "windows_command");
    const resultTool = firstTools.find((tool) => tool.name === "windows_command_result");
    if (!commandTool || !resultTool) {
      throw new Error("Patched MCP catalog is missing windows_command or windows_command_result.");
    }

    const commandSchema = commandTool.inputSchema as JsonObject;
    const commandProperties = commandSchema.properties as JsonObject;
    const providerEpoch = commandSchema["x-codex-provider-epoch"];
    if (typeof providerEpoch !== "string" || !/^[a-f0-9]{32}$/.test(providerEpoch)) {
      throw new Error(`The staging provider did not publish a valid provider epoch. schema=${JSON.stringify(commandSchema)}`);
    }
    if (!("operation_id" in commandProperties) || !("provider_epoch" in commandProperties)) {
      throw new Error("The staging windows_command schema is missing durable identity fields.");
    }
    const resultSchema = resultTool.inputSchema as JsonObject;
    if (resultSchema["x-codex-read-only"] !== true && resultTool.annotations?.readOnlyHint !== true) {
      throw new Error("windows_command_result is not declared read-only.");
    }

    const operationId = `call_${randomBytes(24).toString("base64url")}`;
    const markerLiteral = markerPath.replace(/'/g, "''");
    const command = [
      `Start-Sleep -Seconds ${commandDurationSeconds}`,
      `[System.IO.File]::AppendAllText('${markerLiteral}', 'completed' + [Environment]::NewLine)`,
      "Write-Output 'completed'",
      "exit 0",
    ].join("; ");
    const preparedCommand = attachBrokerOperationId({
      callId: operationId,
      wireName: commandWireName,
      freeform: false,
      readOnly: false,
      providerEpoch,
      operationStatus: statusContract,
      arguments: { command, cwd: stagingRoot, wait_seconds: 0 },
    }, codexTools);
    const commandArguments = preparedCommand.arguments ?? {};
    if (commandArguments.operation_id !== operationId || commandArguments.provider_epoch !== providerEpoch) {
      throw new Error("Infinity did not inject the original broker operation ID and provider epoch.");
    }

    const started = parseToolResult(await first.client.callTool({
      name: "windows_command",
      arguments: commandArguments,
    }));
    commandStarted = true;
    if (started.job_id !== operationId || started.operation_id !== operationId) {
      throw new Error("windows_command did not preserve the requested operation identity.");
    }
    if (started.provider_epoch !== providerEpoch) {
      throw new Error("windows_command returned a different provider epoch.");
    }

    const beforeRestart = parseToolResult(await first.client.callTool({
      name: "windows_command_result",
      arguments: { job_id: operationId, provider_epoch: providerEpoch, wait_seconds: 0 },
    }));
    if (beforeRestart.status !== "running" && beforeRestart.status !== "starting") {
      throw new Error(`The command was not active before restart. status=${String(beforeRestart.status)}`);
    }

    await closeServer(first);
    first = undefined;
    await Bun.sleep(500);

    second = await connectServer(
      "windows-local-staging-after-restart",
      pythonPath,
      join(stagingRoot, "server.py"),
      stagingRoot,
      serverEnv,
    );
    const secondTools = (await second.client.listTools()).tools;
    const secondNames = secondTools.map((tool) => tool.name).sort();
    if (JSON.stringify(firstNames) !== JSON.stringify(secondNames)) {
      throw new Error("The MCP tool catalog changed across provider restart.");
    }
    const restartedCommandTool = secondTools.find((tool) => tool.name === "windows_command");
    const restartedEpoch = (restartedCommandTool?.inputSchema as JsonObject | undefined)?.["x-codex-provider-epoch"];
    if (restartedEpoch !== providerEpoch) {
      throw new Error("The provider epoch changed across the staging restart.");
    }

    const recoveryCall: BrokerRecoveryCall = {
      traceId: "staging-provider-restart",
      callId: operationId,
      tool: commandWireName,
      state: "delivery_unknown",
      readOnly: false,
      providerEpoch,
      operationStatus: statusContract,
      resultRecoverable: false,
      replayAuthorized: false,
    };
    const recoveryChecks = prepareBrokerProviderRecoveryChecks([recoveryCall], asCodexTools(secondTools));
    if (recoveryChecks.length !== 1) {
      throw new Error("Infinity could not build a read-only recovery query from the restarted provider schema.");
    }
    const recoveryCheck = recoveryChecks[0]!;
    if (recoveryCheck.request.wireName !== "mcp__windows_local__windows_command_result"
      || JSON.stringify(recoveryCheck.request.arguments) !== JSON.stringify({
        job_id: operationId, provider_epoch: providerEpoch, wait_seconds: 0,
      })) {
      throw new Error("Infinity's recovery query lost the original job identity or its zero-wait contract.");
    }

    const deadline = Date.now() + Math.max(25_000, (commandDurationSeconds + 10) * 1000);
    let recovered: JsonObject | undefined;
    while (Date.now() < deadline) {
      recovered = parseToolResult(await second.client.callTool({
        name: "windows_command_result",
        arguments: recoveryCheck.request.arguments,
      }));
      if (recovered.status === "completed" || recovered.status === "launch_failed" || recovered.status === "unknown" || recovered.status === "provider_changed") {
        break;
      }
      await Bun.sleep(250);
    }
    if (recovered?.status !== "completed" || recovered.exit_code !== 0) {
      throw new Error(`The restarted provider did not recover the command. result=${JSON.stringify(recovered)}`);
    }
    commandCompleted = true;

    const observedMessages: CodexMessage[] = [
      {
        role: "assistant", timestamp: 1,
        content: [{ type: "toolCall", id: recoveryCheck.request.callId,
          namespace: "mcp__windows_local", name: "windows_command_result",
          arguments: recoveryCheck.request.arguments ?? {} }],
      },
      {
        role: "toolResult", timestamp: 2, toolCallId: recoveryCheck.request.callId,
        toolNamespace: "mcp__windows_local", toolName: "windows_command_result",
        content: JSON.stringify(recovered), isError: false,
      },
    ];
    const observed = observeBrokerProviderRecoveryChecks(recoveryChecks, observedMessages);
    if (observed.received !== 1 || observed.observations.length !== 1
      || observed.observations[0]?.providerStatus !== "completed"
      || observed.observations[0]?.exitCode !== 0) {
      throw new Error("Infinity failed to validate the real provider's recovered status response.");
    }

    const markerLines = readFileSync(markerPath, "utf8").trim().split(/\r?\n/);
    if (markerLines.length !== 1 || markerLines[0] !== "completed") {
      throw new Error(`Expected one provider execution marker, found ${markerLines.length}.`);
    }

    const duplicate = parseToolResult(await second.client.callTool({
      name: "windows_command",
      arguments: commandArguments,
    }));
    if (duplicate.job_id !== operationId || duplicate.status !== "completed") {
      throw new Error("A repeated operation_id did not return the stored completed result.");
    }

    const conflict = await second.client.callTool({
      name: "windows_command",
      arguments: { ...commandArguments, command: `${command}; Write-Output 'conflict'` },
    });
    if (!conflict.isError) {
      throw new Error("The provider accepted different arguments for an existing operation_id.");
    }

    const wrongEpoch = `${providerEpoch[0] === "0" ? "1" : "0"}${providerEpoch.slice(1)}`;
    const changed = parseToolResult(await second.client.callTool({
      name: "windows_command_result",
      arguments: { job_id: operationId, provider_epoch: wrongEpoch, wait_seconds: 0 },
    }));
    if (changed.status !== "provider_changed") {
      throw new Error(`Expected provider_changed for a mismatched epoch, got ${String(changed.status)}.`);
    }

    const finalMarkerLines = readFileSync(markerPath, "utf8").trim().split(/\r?\n/);
    if (finalMarkerLines.length !== 1) {
      throw new Error(`The repeated calls executed the provider ${finalMarkerLines.length} times.`);
    }

    const sourceUnchanged = sha256(sourceServer) === sourceHashes.server
      && sha256(sourceControl) === sourceHashes.windowsControl;
    if (!sourceUnchanged) throw new Error("The live Windows Local source changed during staging validation.");

    console.log(JSON.stringify({
      status: "passed",
      commandDurationSeconds,
      totalMcpTools: secondTools.length,
      windowsTools: secondNames.filter((name) => name.startsWith("windows_")).length,
      catalogStableAcrossRestart: true,
      providerEpochStable: true,
      brokerOperationIdentityVerified: true,
      brokerReadOnlyRecoveryQueryVerified: true,
      brokerStatusObservationVerified: true,
      recoveredStatus: recovered.status,
      exitCode: recovered.exit_code,
      duplicateOperationReused: true,
      conflictingArgumentsRejected: true,
      mismatchedEpochRejected: true,
      providerExecutions: finalMarkerLines.length,
      sourceUnchanged,
    }, null, 2));
  } finally {
    await closeServer(second);
    await closeServer(first);
    if (commandStarted && !commandCompleted) await Bun.sleep((commandDurationSeconds + 1) * 1000);
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
