import assert from "node:assert/strict";
import test from "node:test";

import type { CodexMessage, CodexTool, CodexToolResultMessage } from "../src/types";
import type { BrokerRecoveryCall } from "../src/adapters/chatgpt-web/broker-call-reconciliation";
import { observeBrokerProviderRecoveryChecks, pendingBrokerProviderRecoveryChecks, prepareBrokerProviderRecoveryChecks } from "../src/adapters/chatgpt-web/broker-provider-recovery";
import { attachBrokerOperationId, brokerOperationStatusQueryForCall } from "../src/adapters/chatgpt-web/broker-operation-identity";

const providerEpoch = "a".repeat(32);
const originalCallId = `call_${"b".repeat(32)}`;

const recoveryCall: BrokerRecoveryCall = {
  traceId: "abcd1234abcd",
  callId: originalCallId,
  tool: "mcp__windows_local__windows_command",
  state: "delivery_unknown",
  readOnly: false,
  providerEpoch,
  operationStatus: {
    statusTool: "mcp__windows_local___windows_command_result",
    operationIdArgument: "job_id",
    providerEpochArgument: "provider_epoch",
    waitSecondsArgument: "wait_seconds",
    effectScope: "tracked_process",
  },
  resultRecoverable: false,
  replayAuthorized: false,
};

const tools: CodexTool[] = [
  {
    name: "windows_command", namespace: "mcp__windows_local", description: "Run a command",
    parameters: {
      type: "object",
      properties: { operation_id: { type: "string" }, provider_epoch: { type: "string" } },
      required: ["operation_id", "provider_epoch"],
      "x-codex-operation-id": true,
      "x-codex-provider-epoch": providerEpoch,
      "x-codex-operation-status": {
        status_tool: "windows_command_result",
        operation_id_argument: "job_id",
        provider_epoch_argument: "provider_epoch",
        wait_seconds_argument: "wait_seconds",
        effect_scope: "tracked_process",
      },
    },
  },
  {
    name: "_windows_command_result", namespace: "mcp__windows_local", description: "Read command status",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string" }, provider_epoch: { type: "string" },
        wait_seconds: { type: "integer", minimum: 0, maximum: 30 },
      },
      required: ["job_id", "provider_epoch"],
      "x-codex-read-only": true,
    },
  },
];

function result(checkId: string, data: unknown, isError = false): CodexToolResultMessage {
  return {
    role: "toolResult", toolCallId: checkId,
    toolName: "_windows_command_result", toolNamespace: "mcp__windows_local",
    content: JSON.stringify(data), isError, timestamp: 1,
  };
}

function issued(check: ReturnType<typeof prepareBrokerProviderRecoveryChecks>[number]): CodexMessage {
  return {
    role: "assistant", timestamp: 1,
    content: [{ type: "toolCall", id: check.request.callId,
      name: check.request.wireName, arguments: check.request.arguments ?? {} }],
  };
}

test("prepares stable native read-only recovery calls with the original identity and zero wait", () => {
  const first = prepareBrokerProviderRecoveryChecks([recoveryCall], tools);
  const second = prepareBrokerProviderRecoveryChecks([recoveryCall], tools);
  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.notEqual(first[0]!.request.callId, originalCallId);
  assert.equal(first[0]!.request.readOnly, true);
  assert.deepEqual(first[0]!.request.arguments, {
    job_id: originalCallId, provider_epoch: providerEpoch, wait_seconds: 0,
  });
  assert.equal(prepareBrokerProviderRecoveryChecks([recoveryCall], tools.slice(0, 1)).length, 0);
  const changedTools = structuredClone(tools);
  changedTools[0]!.parameters["x-codex-provider-epoch"] = "c".repeat(32);
  assert.equal(prepareBrokerProviderRecoveryChecks([recoveryCall], changedTools).length, 0);
});

test("does not issue status queries for duplicate provider operation IDs or invalid batch limits", () => {
  const unique = { ...recoveryCall, callId: `call_${"d".repeat(32)}` };
  const duplicate = { ...recoveryCall, traceId: "cccc1234cccc" };
  const checks = prepareBrokerProviderRecoveryChecks([recoveryCall, unique, duplicate], tools);
  assert.deepEqual(checks.map(check => check.originalCallId), [unique.callId]);
  for (const invalidLimit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(prepareBrokerProviderRecoveryChecks([recoveryCall], tools, invalidLimit), []);
    assert.deepEqual(pendingBrokerProviderRecoveryChecks(checks, [], invalidLimit), []);
  }
});

test("observes provider status without revealing command output or authorizing replay", () => {
  const checks = prepareBrokerProviderRecoveryChecks([recoveryCall], tools);
  const checkId = checks[0]!.request.callId;
  assert.deepEqual(observeBrokerProviderRecoveryChecks(checks, []), { received: 0, observations: [] });
  const completed = observeBrokerProviderRecoveryChecks(checks, [issued(checks[0]!), result(checkId, {
    job_id: originalCallId, provider_epoch: providerEpoch, status: "completed", exit_code: 0,
    stdout: "sensitive command output", stderr: "sensitive diagnostics",
  })]);
  assert.deepEqual(completed, { received: 1, observations: [{
    callId: originalCallId, state: "delivery_unknown", effectScope: "tracked_process",
    providerStatus: "completed", exitCode: 0,
  }] });
  assert.equal(JSON.stringify(completed).includes("sensitive"), false);
});

test("treats stale identity, errors, duplicate outputs and ambiguous provider tools as unverified", () => {
  const checks = prepareBrokerProviderRecoveryChecks([recoveryCall], tools);
  const checkId = checks[0]!.request.callId;
  const mismatch = result(checkId, { job_id: originalCallId, provider_epoch: "c".repeat(32), status: "completed" });
  const invalid = [mismatch, result(checkId, { status: "completed" }, true)];
  for (const messages of [[mismatch], invalid, [result(checkId, "invalid")]]) {
    assert.equal(observeBrokerProviderRecoveryChecks(checks, [issued(checks[0]!), ...messages]).observations[0]!.providerStatus, "unverified");
  }
  const changed = observeBrokerProviderRecoveryChecks(checks, [issued(checks[0]!), result(checkId, {
    job_id: originalCallId, provider_epoch: "c".repeat(32), status: "provider_changed",
  })]);
  assert.equal(changed.observations[0]!.providerStatus, "provider_changed");

  const duplicatedTool = [...tools, structuredClone(tools[0]!)];
  assert.equal(brokerOperationStatusQueryForCall(recoveryCall, duplicatedTool), undefined);
  assert.equal(prepareBrokerProviderRecoveryChecks([recoveryCall], duplicatedTool).length, 0);
  assert.throws(() => attachBrokerOperationId({
    callId: checkId, wireName: recoveryCall.tool, freeform: false,
  }, duplicatedTool), /ambiguous provider declarations/);
});

test("rejects contradictory provider epochs and incomplete completed statuses", () => {
  const check = prepareBrokerProviderRecoveryChecks([recoveryCall], tools)[0]!;
  const checkId = check.request.callId;
  const observe = (data: unknown) => observeBrokerProviderRecoveryChecks([check], [
    issued(check), result(checkId, data),
  ]).observations[0]!;

  for (const data of [
    { job_id: originalCallId, provider_epoch: providerEpoch, status: "provider_changed" },
    { job_id: originalCallId, status: "provider_changed" },
    { job_id: originalCallId, provider_epoch: "invalid", status: "provider_changed" },
    { job_id: originalCallId, provider_epoch: providerEpoch, status: "completed" },
    { job_id: originalCallId, provider_epoch: providerEpoch, status: "completed", exit_code: null },
    { job_id: originalCallId, provider_epoch: providerEpoch, status: "completed", exit_code: 0.5 },
  ]) {
    assert.equal(observe(data).providerStatus, "unverified");
  }

  assert.equal(observe({
    operation_id: originalCallId, provider_epoch: "c".repeat(32), status: "provider_changed",
  }).providerStatus, "provider_changed");
  assert.deepEqual(observe({
    operation_id: originalCallId, provider_epoch: providerEpoch, status: "completed", exit_code: 1,
  }), {
    callId: originalCallId, state: "delivery_unknown", effectScope: "tracked_process",
    providerStatus: "completed", exitCode: 1,
  });
});

test("requires the exact native status call before accepting a provider result", () => {
  const check = prepareBrokerProviderRecoveryChecks([recoveryCall], tools)[0]!;
  const reply = result(check.request.callId, {
    job_id: originalCallId, provider_epoch: providerEpoch, status: "completed", exit_code: 0,
  });
  const incorrect: CodexMessage = {
    role: "assistant", timestamp: 1, content: [{
      type: "toolCall", id: check.request.callId, name: check.request.wireName,
      arguments: { job_id: "another-job", provider_epoch: providerEpoch, wait_seconds: 0 },
    }],
  };
  for (const history of [[reply], [incorrect, reply], [issued(check), issued(check), reply]]) {
    assert.equal(observeBrokerProviderRecoveryChecks([check], history).observations[0]!.providerStatus, "unverified");
    assert.deepEqual(pendingBrokerProviderRecoveryChecks([check], history), []);
  }
});

test("batches read-only status checks and resumes after partial native results", () => {
  const calls = Array.from({ length: 18 }, (_, index) => ({
    ...recoveryCall, callId: `call_${index.toString(16).padStart(32, "0")}`,
  }));
  const checks = prepareBrokerProviderRecoveryChecks(calls, tools, 64);
  assert.equal(checks.length, 18);
  const firstBatch = pendingBrokerProviderRecoveryChecks(checks, []);
  assert.equal(firstBatch.length, 16);
  const firstReply = result(firstBatch[0]!.request.callId, {
    job_id: calls[0]!.callId, provider_epoch: providerEpoch, status: "running",
  });
  const firstHistory = [...firstBatch.map(issued), firstReply];
  const secondBatch = pendingBrokerProviderRecoveryChecks(checks, firstHistory);
  assert.equal(secondBatch.length, 2);
  assert.deepEqual(secondBatch.map(check => check.originalCallId), calls.slice(16).map(call => call.callId));
  const allIssued = [...firstHistory, ...secondBatch.map(issued)];
  assert.deepEqual(pendingBrokerProviderRecoveryChecks(checks, allIssued), []);
  assert.deepEqual(observeBrokerProviderRecoveryChecks(checks, allIssued), {
    received: 1, observations: [{
      callId: calls[0]!.callId, state: "delivery_unknown", effectScope: "tracked_process",
      providerStatus: "running",
    }],
  });
  const allReplies = checks.map(check => result(check.request.callId, {
    job_id: check.originalCallId, provider_epoch: providerEpoch, status: "completed",
  }));
  assert.deepEqual(pendingBrokerProviderRecoveryChecks(checks, [...firstBatch.map(issued),
    ...secondBatch.map(issued), ...allReplies]), []);
  assert.equal(observeBrokerProviderRecoveryChecks(checks, [...firstBatch.map(issued),
    ...secondBatch.map(issued), ...allReplies]).observations.length, 18);
});
