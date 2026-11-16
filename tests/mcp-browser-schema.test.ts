import { strict as assert } from "node:assert";
import test from "node:test";

import { modelVisibleToolParameters as browserToolParameters } from "../src/adapters/chatgpt-web/model-visible-tool-parameters";
import type { CodexTool } from "../src/types";

const epoch = "a".repeat(32);

function commandTool(): CodexTool {
  return {
    name: "windows_command", namespace: "mcp__windows_local", description: "Run a tracked command.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        command: { type: "string" }, cwd: { type: "string" },
        operation_id: { type: "string" }, provider_epoch: { type: "string" },
      },
      required: ["command", "cwd", "operation_id", "provider_epoch"],
      "x-codex-operation-id": true,
      "x-codex-provider-epoch": epoch,
      "x-codex-operation-status": {
        status_tool: "windows_command_result", operation_id_argument: "job_id",
        provider_epoch_argument: "provider_epoch", effect_scope: "tracked_process",
      },
    },
  };
}

test("inventory excludes broker-owned operation identity but preserves native tool contract", () => {
  const original = commandTool();
  const before = structuredClone(original.parameters);
  const visible = browserToolParameters(original);
  assert.deepEqual(visible.properties, { command: { type: "string" }, cwd: { type: "string" } });
  assert.deepEqual(visible.required, ["command", "cwd"]);
  assert.equal(visible.additionalProperties, false);
  for (const name of ["x-codex-operation-id", "x-codex-provider-epoch", "x-codex-operation-status"]) {
    assert.equal(visible[name], undefined);
  }
  assert.deepEqual(original.parameters, before, "broker still needs the original identity and status schema");
});

test("status tools retain caller-required epoch and non-opted-in tools remain unchanged", () => {
  const status: CodexTool = {
    name: "windows_command_result", namespace: "mcp__windows_local", description: "Read-only status.",
    parameters: { type: "object", properties: { job_id: { type: "string" }, provider_epoch: { type: "string" } },
      required: ["job_id", "provider_epoch"], "x-codex-read-only": true },
  };
  const visibleStatus = browserToolParameters(status);
  assert.notEqual(visibleStatus, status.parameters);
  assert.deepEqual(visibleStatus.required, ["job_id", "provider_epoch"]);
  assert.equal(visibleStatus["x-codex-read-only"], undefined);
  assert.equal(status.parameters["x-codex-read-only"], true);
  const basic: CodexTool = {
    name: "other", description: "No bridge-owned parameters.", parameters: { type: "object", properties: {}, required: [] },
  };
  assert.equal(browserToolParameters(basic), basic.parameters);
});

test("without a provider epoch declaration only the broker call ID is omitted", () => {
  const input = commandTool();
  delete input.parameters["x-codex-provider-epoch"];
  const visible = browserToolParameters(input);
  assert.deepEqual(visible.required, ["command", "cwd", "provider_epoch"]);
  assert.equal(Object.hasOwn(visible.properties as object, "operation_id"), false);
  assert.equal(Object.hasOwn(visible.properties as object, "provider_epoch"), true);
});
