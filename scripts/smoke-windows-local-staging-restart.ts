import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import { inspectSettledBrokerCallJournal } from "../src/adapters/chatgpt-web/broker-call-reconciliation";
import { attachBrokerOperationId, brokerOperationStatusForTool } from "../src/adapters/chatgpt-web/broker-operation-identity";
import { extendBrokerProviderRecoveryChecks, observeBrokerProviderRecoveryChecks, prepareBrokerProviderRecoveryChecks } from "../src/adapters/chatgpt-web/broker-provider-recovery";
import { callTurnBroker, TurnBroker, type BrokerToolResult } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";

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
  let originalBroker: TurnBroker | undefined;
  let originalSuccessor: TurnBroker | undefined;
  let broker: TurnBroker | undefined;
  let successor: TurnBroker | undefined;
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

    const markerLiteral = markerPath.replace(/'/g, "''");
    const command = [
      `Start-Sleep -Seconds ${commandDurationSeconds}`,
      `[System.IO.File]::AppendAllText('${markerLiteral}', 'completed' + [Environment]::NewLine)`,
      "Write-Output 'completed'",
      "exit 0",
    ].join("; ");
    // Dispatch the mutating command through the real broker IPC. The broker owns
    // the operation ID; a fake client-chosen ID would not prove the crash fence.
    const originalJournal = join(root, "original-broker-journal");
    mkdirSync(originalJournal, { recursive: true });
    const originalOwner = { threadId: randomUUID(), turnId: randomUUID() };
    const originalEnvironment = {
      cwd: stagingRoot, roots: [stagingRoot], writableRoots: [stagingRoot],
      sandboxPolicy: { type: "dangerFullAccess" as const }, tools: codexTools,
    };
    const originalTrace = randomBytes(6).toString("hex");
    originalBroker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "original-broker")));
    originalBroker.enableCallJournal(originalJournal);
    const originalToken = await originalBroker.register(originalEnvironment, 60_000, originalTrace, originalOwner);
    const originalClaim = await callTurnBroker<{ bindingId: string }>(originalBroker.socketPath, {
      method: "claim", token: originalToken,
    });
    const originalInvocation = callTurnBroker<BrokerToolResult>(originalBroker.socketPath, {
      method: "invoke", bindingId: originalClaim.bindingId, wireName: commandWireName,
      arguments: { command, cwd: stagingRoot, wait_seconds: 0 },
    }, 30_000);
    // Handle the pending rejection before it can become an unhandled promise.
    // Require an explicit owner-revocation error, not an unrelated timeout.
    const originalOutcome = originalInvocation.then(() => "unexpected_success", error =>
      error instanceof Error ? error.message : String(error));
    const originalBatch = await originalBroker.nextToolBatch(originalToken);
    const originalCall = originalBatch[0];
    if (originalBatch.length !== 1 || !originalCall || originalCall.readOnly !== false
      || originalCall.wireName !== commandWireName) {
      throw new Error("The original mutating command did not cross the Infinity broker.");
    }
    const operationId = originalCall.callId;
    const brokerArguments = originalCall.arguments ?? {};
    if (originalCall.providerEpoch !== providerEpoch
      || JSON.stringify(brokerArguments) !== JSON.stringify({ command, cwd: stagingRoot, wait_seconds: 0 })) {
      throw new Error("The broker changed the queued command before the adapter received it.");
    }
    // Match the real adapter boundary: it attaches the durable identity only
    // after receiving the broker's original operation ID and tool metadata.
    const preparedCommand = attachBrokerOperationId({
      callId: operationId, wireName: commandWireName, freeform: false,
      readOnly: false, providerEpoch, operationStatus: statusContract,
      arguments: { command, cwd: stagingRoot, wait_seconds: 0 },
    }, codexTools);
    const commandArguments = preparedCommand.arguments ?? {};
    if (commandArguments.operation_id !== operationId || commandArguments.provider_epoch !== providerEpoch) {
      throw new Error("Infinity did not preserve the broker-owned operation ID and provider epoch.");
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

    // Simulate losing the broker after provider acceptance but before recording
    // its result. The durable journal must retain uncertainty and fence the
    // original native turn, while the provider continues the command exactly once.
    await originalBroker.close();
    if (!/Codex turn binding was revoked/.test(await originalOutcome)) {
      throw new Error("The interrupted broker did not explicitly revoke its pending invocation.");
    }
    originalBroker = undefined;
    const orphanedCalls = inspectSettledBrokerCallJournal(originalJournal);
    if (orphanedCalls.length !== 1 || orphanedCalls[0]?.callId !== operationId
      || orphanedCalls[0]?.state !== "retired_uncertain" || orphanedCalls[0]?.readOnly !== false
      || orphanedCalls[0]?.providerEpoch !== providerEpoch) {
      throw new Error("The original broker lost its uncertain mutating call evidence.");
    }
    if (JSON.stringify(orphanedCalls).includes(command)
      || JSON.stringify(orphanedCalls).includes(markerPath)) {
      throw new Error("The broker journal leaked private command arguments.");
    }
    originalSuccessor = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "original-broker-successor")));
    originalSuccessor.enableCallJournal(originalJournal);
    let originalTurnFenced = false;
    try {
      await originalSuccessor.register(originalEnvironment, 60_000, originalTrace, originalOwner);
    } catch (error) {
      originalTurnFenced = error instanceof Error && /reconciliation/.test(error.message);
      if (!originalTurnFenced) throw error;
    }
    if (!originalTurnFenced) {
      throw new Error("The replacement broker accepted an unreconciled mutating native turn.");
    }
    await originalSuccessor.close();
    originalSuccessor = undefined;

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

    // Verify the new event-driven follow-up against the actual restarted staging provider.
    // This is a second read-only call to the *status* tool, never another command dispatch.
    const firstStatus = parseToolResult(await second.client.callTool({
      name: "windows_command_result", arguments: recoveryCheck.request.arguments,
    }));
    let followupStatusVerified = false;
    if (firstStatus.status === "running" || firstStatus.status === "starting") {
      const history: CodexMessage[] = [
        { role: "assistant", timestamp: 1, content: [{ type: "toolCall",
          id: recoveryCheck.request.callId, namespace: "mcp__windows_local",
          name: "windows_command_result", arguments: recoveryCheck.request.arguments ?? {},
        }] },
        { role: "toolResult", timestamp: 2, toolCallId: recoveryCheck.request.callId,
          toolNamespace: "mcp__windows_local", toolName: "windows_command_result",
          content: JSON.stringify(firstStatus), isError: false },
      ];
      const extended = extendBrokerProviderRecoveryChecks(recoveryChecks, history, asCodexTools(secondTools));
      const nextCheck = extended[1];
      if (extended.length !== 2 || !nextCheck || nextCheck.request.callId === recoveryCheck.request.callId
        || nextCheck.request.arguments?.job_id !== operationId
        || nextCheck.request.arguments?.provider_epoch !== providerEpoch
        || nextCheck.request.arguments?.wait_seconds !== 10) {
        throw new Error("Infinity did not prepare a distinct, provider-declared ten-second status follow-up.");
      }
      const followupResult = parseToolResult(await second.client.callTool({
        name: "windows_command_result", arguments: nextCheck.request.arguments,
      }));
      history.push(
        { role: "assistant", timestamp: 3, content: [{ type: "toolCall",
          id: nextCheck.request.callId, namespace: "mcp__windows_local",
          name: "windows_command_result", arguments: nextCheck.request.arguments ?? {},
        }] },
        { role: "toolResult", timestamp: 4, toolCallId: nextCheck.request.callId,
          toolNamespace: "mcp__windows_local", toolName: "windows_command_result",
          content: JSON.stringify(followupResult), isError: false },
      );
      const followupObservation = observeBrokerProviderRecoveryChecks([nextCheck], history).observations[0];
      if (followupObservation?.providerStatus !== followupResult.status
        || !["running", "starting", "completed"].includes(String(followupResult.status))) {
        throw new Error("Infinity did not authenticate its read-only follow-up status response.");
      }
      followupStatusVerified = true;
    } else if (firstStatus.status !== "completed") {
      throw new Error(`Unexpected initial recovery state: ${String(firstStatus.status)}`);
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

    // Exercise the actual broker IPC and journal with the restarted MCP provider. The
    // dispatched operation is a provider-declared read-only status query.
    const brokerJournal = join(root, "broker-journal");
    mkdirSync(brokerJournal, { recursive: true });
    const nativeIdentity = { threadId: randomUUID(), turnId: randomUUID() };
    const brokerEnvironment = {
      cwd: stagingRoot,
      roots: [stagingRoot],
      writableRoots: [],
      sandboxPolicy: { type: "readOnly" as const, networkAccess: false },
      tools: asCodexTools(secondTools),
    };
    const brokerTrace = randomBytes(6).toString("hex");
    broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "broker")));
    broker.enableCallJournal(brokerJournal);
    await broker.listen();
    const token = await broker.register(brokerEnvironment, 60_000, brokerTrace, nativeIdentity);
    const activityId = `activity_${randomBytes(24).toString("base64url")}`;
    const claim = await callTurnBroker<{ bindingId: string }>(broker.socketPath, {
      method: "claim", token, activityId,
    });
    const invocation = callTurnBroker<BrokerToolResult>(broker.socketPath, {
      method: "invoke", bindingId: claim.bindingId,
      wireName: "mcp__windows_local__windows_command_result",
      arguments: recoveryCheck.request.arguments,
    }, 30_000);
    const brokerBatch = await broker.nextToolBatch(token);
    const brokerCall = brokerBatch[0];
    if (brokerBatch.length !== 1 || !brokerCall || brokerCall.readOnly !== true
      || brokerCall.wireName !== "mcp__windows_local__windows_command_result"
      || JSON.stringify(brokerCall.arguments) !== JSON.stringify(recoveryCheck.request.arguments)) {
      throw new Error("The broker changed the read-only provider recovery query.");
    }
    const brokerProviderResult = await second.client.callTool({
      name: "windows_command_result", arguments: brokerCall.arguments,
    });
    const replyContent = brokerProviderResult.content;
    if (!Array.isArray(replyContent)) {
      throw new Error("The staging MCP provider returned an invalid tool result body.");
    }
    const replyIsError = brokerProviderResult.isError;
    if (replyIsError !== undefined && typeof replyIsError !== "boolean") {
      throw new Error("The staging MCP provider returned an invalid tool error flag.");
    }
    const acknowledgedResult: BrokerToolResult = {
      content: replyContent,
      ...(brokerProviderResult.structuredContent === undefined ? {}
        : { structuredContent: brokerProviderResult.structuredContent }),
      ...(replyIsError === undefined ? {} : { isError: replyIsError }),
    };
    broker.completeTool(token, brokerCall.callId, acknowledgedResult);
    const deliveredResult = await invocation;
    if (JSON.stringify(deliveredResult) !== JSON.stringify(acknowledgedResult)) {
      throw new Error("The broker did not return the original MCP tool result.");
    }
    const throughBroker = parseToolResult(deliveredResult);
    if (throughBroker.job_id !== operationId || throughBroker.provider_epoch !== providerEpoch
      || throughBroker.status !== "completed" || throughBroker.exit_code !== 0) {
      throw new Error("The broker's read-only status query returned an unexpected operation.");
    }
    const brokerCalls = inspectSettledBrokerCallJournal(brokerJournal);
    if (brokerCalls.length !== 1 || brokerCalls[0]?.callId !== brokerCall.callId
      || brokerCalls[0]?.traceId !== brokerTrace || brokerCalls[0]?.readOnly !== true
      || brokerCalls[0]?.state !== "result_unavailable") {
      throw new Error("The broker did not durably record the completed MCP invocation.");
    }
    const activity = await callTurnBroker<{ completed: boolean }>(broker.socketPath, {
      method: "activity_complete", token, activityId,
    });
    const revision = broker.beginCompletionFence(token);
    if (!activity.completed || revision === undefined || !broker.commitCompletionFence(token, revision)) {
      throw new Error("The broker did not commit completion after the MCP reply.");
    }
    broker.revoke(token);
    await broker.close();
    successor = TurnBroker.forSocket(defaultBrokerEndpoint(join(root, "broker-successor")));
    successor.enableCallJournal(brokerJournal);
    await successor.listen();
    let fenced = false;
    try {
      await successor.register(brokerEnvironment, 60_000, brokerTrace, nativeIdentity);
    } catch (error) {
      fenced = error instanceof Error && /reconciliation/.test(error.message);
      if (!fenced) throw error;
    }
    if (!fenced) throw new Error("A successor broker accepted a previously used native turn.");

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
      originalMutatingBrokerDispatchVerified: true,
      originalBrokerJournalState: "retired_uncertain",
      originalBrokerRecoveryFenceVerified: true,
      brokerReadOnlyRecoveryQueryVerified: true,
      brokerStatusObservationVerified: true,
      followupStatusVerified,
      brokerMcpDispatchVerified: true,
      brokerJournalVerified: true,
      brokerCompletionFenceVerified: true,
      brokerRestartFenceVerified: true,
      recoveredStatus: recovered.status,
      exitCode: recovered.exit_code,
      duplicateOperationReused: true,
      conflictingArgumentsRejected: true,
      mismatchedEpochRejected: true,
      providerExecutions: finalMarkerLines.length,
      sourceUnchanged,
    }, null, 2));
  } finally {
    await originalSuccessor?.close();
    await originalBroker?.close();
    await successor?.close();
    await broker?.close();
    await closeServer(second);
    await closeServer(first);
    if (commandStarted && !commandCompleted) await Bun.sleep((commandDurationSeconds + 1) * 1000);
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
