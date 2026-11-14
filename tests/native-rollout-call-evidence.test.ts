import { afterAll, afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observeNativeCallOutputs } from "../src/adapters/chatgpt-web/native-rollout-call-evidence";

const turn = "01a06c66-4380-75c6-a0df-318f890ef6de";
const otherTurn = "01a06c66-4310-75c6-a0df-318f890ef6de";
const ordinaryCall = `call_${"A".repeat(32)}`;
const customCall = `call_${"B".repeat(32)}`;
const orphanCall = `call_${"C".repeat(32)}`;
const toolName = (id: string) => id === ordinaryCall ? "ordinary_tool"
  : id === customCall ? "custom_tool" : "orphan_tool";
const taskStarted = (id: string) => ({ type: "event_msg", payload: { type: "task_started", turn_id: id } });
const taskComplete = { type: "event_msg", payload: { type: "task_complete", turn_id: turn } };
const foreignTaskComplete = { type: "event_msg", payload: { type: "task_complete", turn_id: otherTurn } };
const tool = (type: string, call_id: string, owner?: string, name = toolName(call_id)) => ({
  type: "response_item", payload: { type, call_id, output: "private tool output",
    ...(type === "function_call" || type === "custom_tool_call" ? { name } : {}),
    ...(owner ? { internal_chat_message_metadata_passthrough: { turn_id: owner } } : {}),
  },
});

const temp = mkdtempSync(join(tmpdir(), "infinity-native-output-"));
const path = join(temp, "rollout.jsonl");
afterEach(() => rmSync(path, { force: true }));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
function write(records: unknown[]) {
  writeFileSync(path, records.map(item => JSON.stringify(item)).join("\n") + "\n");
}
function observed(...ids: string[]) {
  return [...observeNativeCallOutputs(path, turn,
    ids.map(callId => ({ callId, tool: toolName(callId) })))].sort();
}

test("native output evidence requires the journal's exact tool name", () => {
  write([taskStarted(turn), tool("function_call", ordinaryCall, undefined, "different_tool"),
    tool("function_call_output", ordinaryCall), taskComplete]);
  expect(observed(ordinaryCall)).toEqual([]);

  write([taskStarted(turn), { type: "response_item", payload: {
    type: "function_call", call_id: ordinaryCall } },
    tool("function_call_output", ordinaryCall), taskComplete]);
  expect(observed(ordinaryCall)).toEqual([]);

  write([taskStarted(turn), tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall), taskComplete]);
  expect(observed(ordinaryCall)).toEqual([ordinaryCall]);
});

test("native function and custom outputs are observed only within the authenticated task boundary", () => {
  write([
    taskStarted(otherTurn), tool("function_call", orphanCall),
    tool("function_call_output", orphanCall), foreignTaskComplete,
    taskStarted(turn), tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall), tool("custom_tool_call", customCall),
    tool("custom_tool_call_output", customCall), taskComplete,
    taskStarted(otherTurn), tool("function_call", orphanCall),
    tool("function_call_output", orphanCall),
  ]);
  expect(observed(ordinaryCall, customCall, orphanCall)).toEqual([ordinaryCall, customCall]);
});

test("foreign task output, absent invocation, wrong output type and duplicated calls never authenticate", () => {
  write([taskStarted(otherTurn), tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall), foreignTaskComplete, taskStarted(turn)]);
  expect(observed(ordinaryCall)).toEqual([]);
  write([taskStarted(turn), tool("function_call_output", ordinaryCall)]);
  expect(observed(ordinaryCall)).toEqual([]);
  write([taskStarted(turn), tool("custom_tool_call", ordinaryCall),
    tool("function_call_output", ordinaryCall)]);
  expect(observed(ordinaryCall)).toEqual([]);
  write([taskStarted(turn), tool("function_call", ordinaryCall),
    tool("function_call", ordinaryCall), tool("function_call_output", ordinaryCall)]);
  expect(observed(ordinaryCall)).toEqual([]);
  write([taskStarted(turn), tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall), tool("function_call_output", ordinaryCall)]);
  expect(observed(ordinaryCall)).toEqual([]);
});

test("repeated task boundary and compaction suppress native output evidence", () => {
  write([taskStarted(turn), tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall), taskComplete,
    taskStarted(turn), tool("function_call", customCall)]);
  expect(observed(ordinaryCall)).toEqual([]);
  write([taskStarted(turn), tool("function_call", ordinaryCall),
    { type: "compacted", payload: { replacement_history: [] } },
    tool("function_call_output", ordinaryCall)]);
  expect(observed(ordinaryCall)).toEqual([]);
});

test("interleaved root and subagent turns use explicit native tool ownership", () => {
  write([taskStarted(otherTurn), taskStarted(turn),
    tool("function_call", ordinaryCall, turn),
    tool("function_call_output", ordinaryCall, turn),
    foreignTaskComplete, taskComplete]);
  expect(observed(ordinaryCall)).toEqual([ordinaryCall]);

  write([taskStarted(otherTurn), taskStarted(turn),
    tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall),
    foreignTaskComplete, taskComplete]);
  expect(observed(ordinaryCall)).toEqual([]);

  write([taskStarted(turn), tool("function_call", ordinaryCall, turn),
    taskStarted(otherTurn), tool("function_call", ordinaryCall, otherTurn),
    tool("function_call_output", ordinaryCall, otherTurn), foreignTaskComplete,
    tool("function_call_output", ordinaryCall, turn), taskComplete]);
  expect(observed(ordinaryCall)).toEqual([ordinaryCall]);

  write([taskStarted(turn), tool("function_call", ordinaryCall, turn),
    taskStarted(otherTurn), tool("function_call_output", ordinaryCall, otherTurn),
    foreignTaskComplete, taskComplete]);
  expect(observed(ordinaryCall)).toEqual([]);

  write([taskStarted(turn), tool("function_call", ordinaryCall),
    taskStarted(otherTurn), tool("function_call_output", ordinaryCall),
    foreignTaskComplete, taskComplete]);
  expect(observed(ordinaryCall)).toEqual([]);

  write([taskStarted(turn), tool("function_call", ordinaryCall),
    taskStarted(otherTurn), tool("function_call_output", ordinaryCall, turn),
    { type: "event_msg", payload: { type: "task_complete" } }]);
  expect(observed(ordinaryCall)).toEqual([]);
});

test("unidentified native task start cannot authorize target outputs", () => {
  write([{ type: "event_msg", payload: { type: "task_started" } },
    taskStarted(turn), tool("function_call", ordinaryCall, turn),
    tool("function_call_output", ordinaryCall, turn), taskComplete]);
  expect(observed(ordinaryCall)).toEqual([]);
});

test("unbalanced foreign task boundaries cannot authorize legacy outputs", () => {
  write([taskStarted(otherTurn), taskStarted(otherTurn), taskStarted(turn),
    foreignTaskComplete, tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall), taskComplete]);
  expect(observed(ordinaryCall)).toEqual([]);

  write([taskStarted(turn), foreignTaskComplete,
    tool("function_call", ordinaryCall), tool("function_call_output", ordinaryCall), taskComplete]);
  expect(observed(ordinaryCall)).toEqual([]);
});

test("unmatched native target completion cannot authorize later call output", () => {
  write([taskComplete, taskStarted(turn),
    tool("function_call", ordinaryCall), tool("function_call_output", ordinaryCall), taskComplete]);
  expect(observed(ordinaryCall)).toEqual([]);

  write([taskStarted(turn), tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall), taskComplete, taskComplete]);
  expect(observed(ordinaryCall)).toEqual([]);
});

test("malformed explicit native tool owner never falls back to legacy single-turn attribution", () => {
  for (const malformed of [null, [], "invalid", {}, { turn_id: null }, { turn_id: "" }]) {
    write([taskStarted(turn), tool("function_call", ordinaryCall),
      { type: "response_item", payload: { type: "function_call_output", call_id: ordinaryCall,
        internal_chat_message_metadata_passthrough: malformed } }, taskComplete]);
    expect(observed(ordinaryCall)).toEqual([]);

    write([taskStarted(turn), { type: "response_item", payload: {
      type: "function_call", call_id: ordinaryCall, name: "ordinary_tool",
      internal_chat_message_metadata_passthrough: malformed } },
    tool("function_call_output", ordinaryCall), taskComplete]);
    expect(observed(ordinaryCall)).toEqual([]);
  }
});

test("legacy completion without a turn id retains isolated native output evidence", () => {
  write([taskStarted(turn), tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall),
    { type: "event_msg", payload: { type: "task_complete" } },
    taskStarted(otherTurn), tool("function_call", customCall, otherTurn),
    tool("function_call_output", customCall, otherTurn), foreignTaskComplete]);
  expect(observed(ordinaryCall, customCall)).toEqual([ordinaryCall]);
});

test("incomplete EOF, malformed JSONL and invalid identities suppress evidence", () => {
  write([taskStarted(turn), tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall)]);
  expect(observed(ordinaryCall)).toEqual([ordinaryCall]);
  expect(observed(ordinaryCall, ordinaryCall)).toEqual([]);
  expect(observed("unsupported-id")).toEqual([]);
  appendFileSync(path, '{"type":');
  expect(observed(ordinaryCall)).toEqual([]);
  write([taskStarted(turn), "bad record", tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall)]);
  expect(observed(ordinaryCall)).toEqual([]);
  write([taskStarted(turn), tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall)]);
  appendFileSync(path, "{not json}\n");
  expect(observed(ordinaryCall)).toEqual([]);
});

test("oversized native rollout suppresses evidence without reading its content", () => {
  write([taskStarted(turn), tool("function_call", ordinaryCall),
    tool("function_call_output", ordinaryCall)]);
  truncateSync(path, 128 * 1024 * 1024 + 1);
  expect(observed(ordinaryCall)).toEqual([]);
});
