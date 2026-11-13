import assert from "node:assert/strict";
import test from "node:test";

import type { CodexTool } from "../src/types";
import type { BrokerToolRequest } from "../src/adapters/chatgpt-web/turn-broker";
import { attachBrokerOperationId, brokerOperationStatusForTool, brokerOperationStatusQueryForCall, brokerToolIsReadOnly } from "../src/adapters/chatgpt-web/broker-operation-identity";

const callId = "call_" + "A".repeat(32);

function request(overrides: Partial<BrokerToolRequest> = {}): BrokerToolRequest {
  return {
    callId,
    wireName: "mcp__windows_local__windows_command",
    freeform: false,
    arguments: { command: "Get-Date", cwd: "E:\\Projetos" },
    ...overrides,
  };
}

function tool(parameters: Record<string, unknown>): CodexTool {
  return {
    name: "windows_command",
    namespace: "mcp__windows_local",
    description: "Run a local command.",
    parameters,
  };
}

test("injects the stable broker call ID only for an opted-in provider tool", () => {
  const current = request();
  const result = attachBrokerOperationId(current, [
    tool({
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        operation_id: { type: "string" },
      },
      required: ["command", "cwd"],
      additionalProperties: false,
      "x-codex-operation-id": true,
    }),
  ]);

  assert.deepEqual(result.arguments, {
    command: "Get-Date",
    cwd: "E:\\Projetos",
    operation_id: callId,
  });
  assert.equal(result.callId, callId);
  assert.equal(current.arguments?.operation_id, undefined);
});

test("broker identity overrides a model-supplied operation ID", () => {
  const result = attachBrokerOperationId(request({
    arguments: { command: "Get-Date", operation_id: "call_other" },
  }), [
    tool({
      properties: { operation_id: { type: "string" } },
      "x-codex-operation-id": true,
    }),
  ]);

  assert.equal(result.arguments?.operation_id, callId);
});

test("injects a provider epoch advertised by the tool schema", () => {
  const providerEpoch = "b".repeat(32);
  const result = attachBrokerOperationId(request({ providerEpoch }), [
    tool({
      properties: {
        operation_id: { type: "string" },
        provider_epoch: { type: "string" },
      },
      "x-codex-operation-id": true,
      "x-codex-provider-epoch": providerEpoch,
    }),
  ]);

  assert.equal(result.arguments?.operation_id, callId);
  assert.equal(result.arguments?.provider_epoch, providerEpoch);
});

test("injects a provider epoch even when the tool does not opt into operation IDs", () => {
  const providerEpoch = "c".repeat(32);
  const result = attachBrokerOperationId(request({ providerEpoch }), [
    tool({
      properties: { provider_epoch: { type: "string" } },
      "x-codex-provider-epoch": providerEpoch,
    }),
  ]);

  assert.equal(result.arguments?.provider_epoch, providerEpoch);
  assert.equal(result.arguments?.operation_id, undefined);
});

test("rejects a provider epoch that changes after the broker queued the operation", () => {
  assert.throws(
    () => attachBrokerOperationId(request({ providerEpoch: "b".repeat(32) }), [
      tool({
        properties: { provider_epoch: { type: "string" } },
        "x-codex-provider-epoch": "c".repeat(32),
      }),
    ]),
    /provider epoch changed while the broker call was queued/,
  );
});

test("leaves tools without the explicit extension unchanged", () => {
  const current = request();
  const result = attachBrokerOperationId(current, [
    tool({
      type: "object",
      properties: { command: { type: "string" } },
    }),
  ]);

  assert.equal(result, current);
});

test("only an explicit structured provider declaration classifies a tool as read-only", () => {
  const declared = tool({
    type: "object", properties: { job_id: { type: "string" } },
    "x-codex-read-only": true,
  });
  assert.equal(brokerToolIsReadOnly("mcp__windows_local__windows_command", [declared]), true);
  assert.equal(brokerToolIsReadOnly("mcp__windows_local__windows_command", [
    tool({ type: "object", properties: { job_id: { type: "string" } } }),
  ]), false);
  assert.equal(brokerToolIsReadOnly("mcp__windows_local__windows_command", [
    { ...declared, freeform: true },
  ]), false);
  assert.equal(brokerToolIsReadOnly("mcp__windows_local__windows_command", [
    tool({ type: "array", properties: {}, "x-codex-read-only": true }),
  ]), false);
});

test("leaves requests unchanged when the provider tool is absent", () => {
  const current = request();

  assert.equal(attachBrokerOperationId(current, []), current);
});

test("leaves freeform tools unchanged", () => {
  const current = request({ freeform: true });
  const result = attachBrokerOperationId(current, [
    tool({
      properties: { operation_id: { type: "string" } },
      "x-codex-operation-id": true,
    }),
  ]);

  assert.equal(result, current);
});

test("rejects a malformed provider operation-ID declaration", () => {
  assert.throws(
    () => attachBrokerOperationId(request(), [
      tool({
        properties: { command: { type: "string" } },
        "x-codex-operation-id": true,
      }),
    ]),
    /without a string operation_id property/,
  );
});

test("rejects a malformed broker call ID for an opted-in tool", () => {
  assert.throws(
    () => attachBrokerOperationId(request({ callId: "call_short" }), [
      tool({
        properties: { operation_id: { type: "string" } },
        "x-codex-operation-id": true,
      }),
    ]),
    /invalid operation identity/,
  );
});

test("rejects a provider epoch extension without a matching schema property", () => {
  assert.throws(
    () => attachBrokerOperationId(request(), [
      tool({
        properties: { operation_id: { type: "string" } },
        "x-codex-operation-id": true,
        "x-codex-provider-epoch": "b".repeat(32),
      }),
    ]),
    /invalid provider epoch/,
  );
});

test("rejects a provider epoch that is not a 32-character lowercase hexadecimal value", () => {
  assert.throws(
    () => attachBrokerOperationId(request(), [
      tool({
        properties: { provider_epoch: { type: "string" } },
        "x-codex-provider-epoch": "not-an-epoch",
      }),
    ]),
    /invalid provider epoch/,
  );
});

test("resolves a provider-declared read-only status tool in the same MCP namespace", () => {
  const providerEpoch = "d".repeat(32);
  const tools: CodexTool[] = [
    tool({
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
    }),
    {
      name: "_windows_command_result",
      namespace: "mcp__windows_local",
      description: "Read command job status.",
      parameters: {
        type: "object",
        properties: {
          job_id: { type: "string" },
          provider_epoch: { type: "string" },
          wait_seconds: { type: "integer" },
        },
        required: ["job_id", "provider_epoch"],
        "x-codex-read-only": true,
      },
    },
  ];

  const contract = brokerOperationStatusForTool(request().wireName, tools);
  assert.deepEqual(contract, {
    statusTool: "mcp__windows_local___windows_command_result",
    operationIdArgument: "job_id",
    providerEpochArgument: "provider_epoch",
    waitSecondsArgument: "wait_seconds",
    effectScope: "tracked_process",
  });
  const delivered = attachBrokerOperationId(request({ providerEpoch, operationStatus: contract }), tools);
  assert.equal(delivered.arguments?.operation_id, callId);
  assert.equal(delivered.arguments?.provider_epoch, providerEpoch);

  const unsupportedRequired = structuredClone(tools);
  unsupportedRequired[1]!.parameters.required = ["job_id", "provider_epoch", "authorization"];
  assert.throws(() => brokerOperationStatusForTool(request().wireName, unsupportedRequired),
    /validated read-only query/);

  const missingStatusEpoch = structuredClone(tools);
  missingStatusEpoch[1]!.parameters.required = ["job_id"];
  assert.throws(() => brokerOperationStatusForTool(request().wireName, missingStatusEpoch),
    /validated read-only query/);

  const missingOperationEpoch = structuredClone(tools);
  missingOperationEpoch[0]!.parameters.required = ["operation_id"];
  assert.throws(() => brokerOperationStatusForTool(request().wireName, missingOperationEpoch),
    /invalid operation status contract/);

  const missingObjectSchema = structuredClone(tools);
  delete missingObjectSchema[1]!.parameters.type;
  assert.throws(() => brokerOperationStatusForTool(request().wireName, missingObjectSchema),
    /validated read-only query/);

  const blockingWait = structuredClone(tools);
  (blockingWait[1]!.parameters.properties as Record<string, unknown>).wait_seconds =
    { type: "integer", minimum: 1 };
  assert.throws(() => brokerOperationStatusForTool(request().wireName, blockingWait),
    /wait argument is invalid/);
});

test("rejects operation status tools without an explicit read-only declaration", () => {
  const providerEpoch = "d".repeat(32);
  const tools: CodexTool[] = [
    tool({
      properties: { operation_id: { type: "string" }, provider_epoch: { type: "string" } },
      required: ["operation_id", "provider_epoch"],
      "x-codex-operation-id": true,
      "x-codex-provider-epoch": providerEpoch,
      "x-codex-operation-status": {
        status_tool: "windows_command_result",
        operation_id_argument: "job_id",
        provider_epoch_argument: "provider_epoch",
        effect_scope: "tracked_process",
      },
    }),
    {
      name: "windows_command_result",
      namespace: "mcp__windows_local",
      description: "Status query without read-only declaration.",
      parameters: {
        properties: { job_id: { type: "string" }, provider_epoch: { type: "string" } },
        required: ["job_id"],
      },
    },
  ];

  assert.throws(() => brokerOperationStatusForTool(request().wireName, tools), /validated read-only query/);
});

test("builds a read-only status query only while the provider epoch and contract still match", () => {
  const providerEpoch = "d".repeat(32);
  const tools: CodexTool[] = [
    tool({
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
    }),
    {
      name: "_windows_command_result",
      namespace: "mcp__windows_local",
      description: "Read command job status.",
      parameters: {
        type: "object",
        properties: {
          job_id: { type: "string" },
          provider_epoch: { type: "string" },
          wait_seconds: { type: "integer" },
        },
        required: ["job_id", "provider_epoch"],
        "x-codex-read-only": true,
      },
    },
  ];
  const operationStatus = brokerOperationStatusForTool(request().wireName, tools);
  const call = { callId: `call_${"e".repeat(32)}`, tool: request().wireName, providerEpoch, operationStatus };

  assert.deepEqual(brokerOperationStatusQueryForCall(call, tools), {
    wireName: "mcp__windows_local___windows_command_result",
    arguments: { job_id: call.callId, provider_epoch: providerEpoch, wait_seconds: 0 },
    effectScope: "tracked_process",
  });

  const changedTools = structuredClone(tools);
  changedTools[0]!.parameters["x-codex-provider-epoch"] = "f".repeat(32);
  assert.equal(brokerOperationStatusQueryForCall(call, changedTools), undefined);

  const malformedTools = structuredClone(tools);
  malformedTools[0]!.parameters["x-codex-provider-epoch"] = "invalid";
  assert.equal(brokerOperationStatusQueryForCall(call, malformedTools), undefined);

  const untrustedStatusTool = structuredClone(tools);
  untrustedStatusTool[1]!.parameters["x-codex-read-only"] = false;
  assert.equal(brokerOperationStatusQueryForCall(call, untrustedStatusTool), undefined);
});

test("rejects operation status tools from another provider namespace", () => {
  const providerEpoch = "d".repeat(32);
  const tools: CodexTool[] = [
    tool({
      properties: { operation_id: { type: "string" }, provider_epoch: { type: "string" } },
      required: ["operation_id", "provider_epoch"],
      "x-codex-operation-id": true,
      "x-codex-provider-epoch": providerEpoch,
      "x-codex-operation-status": {
        status_tool: "windows_command_result",
        operation_id_argument: "job_id",
        provider_epoch_argument: "provider_epoch",
        effect_scope: "tracked_process",
      },
    }),
    {
      name: "windows_command_result",
      namespace: "mcp__other_provider",
      description: "Status query.",
      parameters: {
        properties: { job_id: { type: "string" }, provider_epoch: { type: "string" } },
        required: ["job_id"],
        "x-codex-read-only": true,
      },
    },
  ];

  assert.throws(() => brokerOperationStatusForTool(request().wireName, tools), /missing or ambiguous/);
});

test("rejects a provider status contract that changes after the operation was queued", () => {
  const providerEpoch = "d".repeat(32);
  const tools: CodexTool[] = [
    tool({
      properties: { operation_id: { type: "string" }, provider_epoch: { type: "string" } },
      required: ["operation_id", "provider_epoch"],
      "x-codex-operation-id": true,
      "x-codex-provider-epoch": providerEpoch,
      "x-codex-operation-status": {
        status_tool: "windows_command_result",
        operation_id_argument: "job_id",
        provider_epoch_argument: "provider_epoch",
        effect_scope: "tracked_process",
      },
    }),
    {
      name: "windows_command_result",
      namespace: "mcp__windows_local",
      description: "Status query.",
      parameters: {
        type: "object",
        properties: { job_id: { type: "string" }, provider_epoch: { type: "string" } },
        required: ["job_id", "provider_epoch"],
        "x-codex-read-only": true,
      },
    },
  ];
  const operationStatus = brokerOperationStatusForTool(request().wireName, tools);
  const changedTools = structuredClone(tools);
  changedTools[0]!.parameters["x-codex-operation-status"] = {
    status_tool: "windows_command_result",
    operation_id_argument: "job_id",
    provider_epoch_argument: "provider_epoch",
    effect_scope: "provider_operation",
  };

  assert.throws(() => attachBrokerOperationId(request({ providerEpoch, operationStatus }), changedTools),
    /operation status contract changed while the broker call was queued/);
});
