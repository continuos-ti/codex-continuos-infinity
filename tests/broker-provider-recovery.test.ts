import assert from "node:assert/strict";
import test from "node:test";

import type { CodexMessage, CodexTool, CodexToolResultMessage } from "../src/types";
import type { BrokerRecoveryCall } from "../src/adapters/chatgpt-web/broker-call-reconciliation";
import { extendBrokerProviderRecoveryChecks, observeBrokerProviderRecoveryChecks, pendingBrokerProviderRecoveryChecks, prepareBrokerProviderRecoveryChecks } from "../src/adapters/chatgpt-web/broker-provider-recovery";
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

  const matchingStatusEpoch = structuredClone(tools);
  matchingStatusEpoch[1]!.parameters["x-codex-provider-epoch"] = providerEpoch;
  const withStatusEpoch = prepareBrokerProviderRecoveryChecks([recoveryCall], matchingStatusEpoch);
  assert.equal(withStatusEpoch.length, 1);
  assert.equal(withStatusEpoch[0]!.request.providerEpoch, providerEpoch);
  assert.deepEqual(withStatusEpoch[0]!.request.arguments, first[0]!.request.arguments);
  const conflictingStatusEpoch = structuredClone(tools);
  conflictingStatusEpoch[1]!.parameters["x-codex-provider-epoch"] = "c".repeat(32);
  assert.deepEqual(prepareBrokerProviderRecoveryChecks([recoveryCall], conflictingStatusEpoch), []);
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

test("rejects conflicting identities or execution claims in provider status envelopes", () => {
  const check = prepareBrokerProviderRecoveryChecks([recoveryCall], tools)[0]!;
  const observe = (data: unknown) => observeBrokerProviderRecoveryChecks([check], [
    issued(check), result(check.request.callId, data),
  ]).observations[0]!.providerStatus;
  const completed = { job_id: originalCallId, provider_epoch: providerEpoch,
    status: "completed", exit_code: 0 };
  assert.equal(observe({ ...completed, operation_id: `call_${"d".repeat(32)}` }), "unverified");
  assert.equal(observe({ ...completed, job_id: `call_${"d".repeat(32)}`,
    operation_id: originalCallId }), "unverified");
  assert.equal(observe({ job_id: `call_${"d".repeat(32)}`,
    result: completed }), "unverified");
  assert.equal(observe({ operation_id: originalCallId, provider_epoch: "c".repeat(32),
    result: completed }), "unverified");
  assert.equal(observe({ status: "running", result: completed }), "unverified");
  assert.equal(observe({ exit_code: 1, result: completed }), "unverified");
  assert.equal(observe({ ...completed, operation_id: originalCallId }), "completed");
  assert.equal(observe({ job_id: originalCallId, result: completed }), "completed");
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
  assert.equal(secondBatch.length, 1);
  assert.deepEqual(secondBatch.map(check => check.originalCallId), [calls[16]!.callId]);
  const secondHistory = [...firstHistory, ...secondBatch.map(issued)];
  assert.deepEqual(pendingBrokerProviderRecoveryChecks(checks, secondHistory), []);
  const delayedReply = result(firstBatch[1]!.request.callId, {
    job_id: calls[1]!.callId, provider_epoch: providerEpoch, status: "running",
  });
  const thirdBatch = pendingBrokerProviderRecoveryChecks(checks, [...secondHistory, delayedReply]);
  assert.deepEqual(thirdBatch.map(check => check.originalCallId), [calls[17]!.callId]);
  const allIssued = [...secondHistory, delayedReply, ...thirdBatch.map(issued)];
  assert.deepEqual(pendingBrokerProviderRecoveryChecks(checks, allIssued), []);
  assert.deepEqual(observeBrokerProviderRecoveryChecks(checks, allIssued), {
    received: 2, observations: [{
      callId: calls[0]!.callId, state: "delivery_unknown", effectScope: "tracked_process",
      providerStatus: "running",
    }, {
      callId: calls[1]!.callId, state: "delivery_unknown", effectScope: "tracked_process",
      providerStatus: "running",
    }],
  });
  const allReplies = checks.map(check => result(check.request.callId, {
    job_id: check.originalCallId, provider_epoch: providerEpoch, status: "completed",
  }));
  assert.deepEqual(pendingBrokerProviderRecoveryChecks(checks, [...firstBatch.map(issued),
    ...secondBatch.map(issued), ...thirdBatch.map(issued), ...allReplies]), []);
  assert.equal(observeBrokerProviderRecoveryChecks(checks, [...firstBatch.map(issued),
    ...secondBatch.map(issued), ...thirdBatch.map(issued), ...allReplies]).observations.length, 18);
});

test("extends verified running status checks using new bounded native read-only IDs", () => {
  const first = prepareBrokerProviderRecoveryChecks([recoveryCall], tools)[0]!;
  const history: CodexMessage[] = [issued(first), result(first.request.callId, {
    job_id: originalCallId, provider_epoch: providerEpoch, status: "running",
  })];
  const extended = extendBrokerProviderRecoveryChecks([first], history, tools);
  assert.equal(extended.length, 2);
  assert.notEqual(extended[1]!.request.callId, first.request.callId);
  assert.deepEqual(extended[1]!.request.arguments, {
    job_id: originalCallId, provider_epoch: providerEpoch, wait_seconds: 10,
  });
  assert.equal(extended[1]!.request.readOnly, true);
  assert.deepEqual(extendBrokerProviderRecoveryChecks([first], history, tools), extended);
  assert.deepEqual(pendingBrokerProviderRecoveryChecks(extended, history), [extended[1]]);

  history.push(issued(extended[1]!), result(extended[1]!.request.callId, {
    job_id: originalCallId, provider_epoch: providerEpoch, status: "starting",
  }));
  const third = extendBrokerProviderRecoveryChecks([first], history, tools);
  assert.equal(third.length, 3);
  assert.notEqual(third[2]!.request.callId, third[1]!.request.callId);
  assert.equal(third[2]!.request.arguments?.wait_seconds, 10);

  history.push(issued(third[2]!), result(third[2]!.request.callId, {
    job_id: originalCallId, provider_epoch: providerEpoch, status: "completed", exit_code: 0,
  }));
  const terminal = extendBrokerProviderRecoveryChecks([first], history, tools);
  assert.equal(terminal.length, 3);
  assert.deepEqual(pendingBrokerProviderRecoveryChecks(terminal, history), []);
});

test("read-only status polls stop on unverified results, epoch changes and unsafe wait schemas", () => {
  const first = prepareBrokerProviderRecoveryChecks([recoveryCall], tools)[0]!;
  for (const reply of [
    { job_id: originalCallId, provider_epoch: "c".repeat(32), status: "running" },
    { job_id: originalCallId, provider_epoch: providerEpoch, status: "provider_changed" },
    { job_id: originalCallId, provider_epoch: providerEpoch, status: "unknown" },
    { job_id: originalCallId, provider_epoch: providerEpoch, status: "completed", exit_code: 0 },
  ]) {
    assert.deepEqual(extendBrokerProviderRecoveryChecks([first], [issued(first),
      result(first.request.callId, reply)], tools), [first]);
  }
  assert.deepEqual(extendBrokerProviderRecoveryChecks([first], [result(first.request.callId, {
    job_id: originalCallId, provider_epoch: providerEpoch, status: "running",
  })], tools), [first]);

  const running = [issued(first), result(first.request.callId, {
    job_id: originalCallId, provider_epoch: providerEpoch, status: "running",
  })];
  const changed = structuredClone(tools);
  (changed[1]!.parameters.properties as Record<string, unknown>).wait_seconds = {
    type: "integer", minimum: 0, maximum: 5,
  };
  const fallback = extendBrokerProviderRecoveryChecks([first], running, changed);
  assert.equal(fallback[1]!.request.arguments?.wait_seconds, 0);
  assert.equal(extendBrokerProviderRecoveryChecks([first], running, tools, 1).length, 1);
  assert.equal(extendBrokerProviderRecoveryChecks([first], running, tools, 0).length, 1);

  const withOperationIdentity = structuredClone(tools);
  withOperationIdentity[1]!.parameters["x-codex-operation-id"] = true;
  (withOperationIdentity[1]!.parameters.properties as Record<string, unknown>).operation_id = { type: "string" };
  const statusWithIdentity = prepareBrokerProviderRecoveryChecks([recoveryCall], withOperationIdentity)[0]!;
  const historyWithIdentity = [issued(statusWithIdentity), result(statusWithIdentity.request.callId, {
    job_id: originalCallId, provider_epoch: providerEpoch, status: "running",
  })];
  const followup = extendBrokerProviderRecoveryChecks([statusWithIdentity], historyWithIdentity, withOperationIdentity)[1]!;
  assert.equal(followup.request.arguments?.operation_id, followup.request.callId);
  assert.notEqual(followup.request.arguments?.operation_id, statusWithIdentity.request.callId);
});

test("long-running recovery status remains bounded after twelve unique checks", () => {
  const first = prepareBrokerProviderRecoveryChecks([recoveryCall], tools)[0]!;
  const history: CodexMessage[] = [];
  const ids = new Set<string>();
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidates = extendBrokerProviderRecoveryChecks([first], history, tools);
    assert.equal(candidates.length, attempt + 1);
    const next = candidates.at(-1)!;
    assert.equal(ids.has(next.request.callId), false);
    ids.add(next.request.callId);
    history.push(issued(next), result(next.request.callId, {
      job_id: originalCallId, provider_epoch: providerEpoch, status: "running",
    }));
  }
  const exhausted = extendBrokerProviderRecoveryChecks([first], history, tools);
  assert.equal(exhausted.length, 12);
  assert.deepEqual(pendingBrokerProviderRecoveryChecks(exhausted, history), []);
  assert.equal(ids.size, 12);
});
