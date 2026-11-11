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
const taskStarted = (id: string) => ({ type: "event_msg", payload: { type: "task_started", turn_id: id } });
const taskComplete = { type: "event_msg", payload: { type: "task_complete" } };
const tool = (type: string, call_id: string) => ({
  type: "response_item", payload: { type, call_id, output: "private tool output" },
});

const temp = mkdtempSync(join(tmpdir(), "infinity-native-output-"));
const path = join(temp, "rollout.jsonl");
afterEach(() => rmSync(path, { force: true }));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
function write(records: unknown[]) {
  writeFileSync(path, records.map(item => JSON.stringify(item)).join("\n") + "\n");
}
function observed(...ids: string[]) {
  return [...observeNativeCallOutputs(path, turn, ids)].sort();
}

test("native function and custom outputs are observed only within the authenticated task boundary", () => {
  write([
    taskStarted(otherTurn), tool("function_call", orphanCall),
    tool("function_call_output", orphanCall), taskComplete,
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
    tool("function_call_output", ordinaryCall), taskComplete, taskStarted(turn)]);
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
