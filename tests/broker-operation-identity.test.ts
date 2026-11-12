import assert from "node:assert/strict";
import test from "node:test";

import type { CodexTool } from "../src/types";
import type { BrokerToolRequest } from "../src/adapters/chatgpt-web/turn-broker";
import { attachBrokerOperationId } from "../src/adapters/chatgpt-web/broker-operation-identity";

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
  const result = attachBrokerOperationId(request(), [
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
  const result = attachBrokerOperationId(request(), [
    tool({
      properties: { provider_epoch: { type: "string" } },
      "x-codex-provider-epoch": providerEpoch,
    }),
  ]);

  assert.equal(result.arguments?.provider_epoch, providerEpoch);
  assert.equal(result.arguments?.operation_id, undefined);
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
