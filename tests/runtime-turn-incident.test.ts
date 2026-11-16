import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";
import { classifyRuntimeFailure, recordRuntimeTurnIncident, type RuntimeFailureClass } from "../src/adapters/chatgpt-web/runtime-turn-incident";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "infinity-runtime-incident-"));
  roots.push(root);
  return {
    directory: join(root, "diagnostics", "runtime-incidents"),
    traceId: "1144aabbccdd",
    identity: {
      threadId: "01a06c66-a0af-7769-b04e-976542277181",
      turnId: "01a06c66-37dc-7c86-85f9-a92e0bb6b638",
    },
  };
}

function error(code: string, message = "secret-example D:/private") {
  return new ChatGptWebAdapterError(message, { code, status: 503, errorType: "server_error", retryable: false });
}

test("records sanitized, durable evidence of a failed accepted turn with unknown prior tool effects", () => {
  const input = fixture();
  const saved = recordRuntimeTurnIncident({ ...input, error: error("chatgpt_response_incomplete"),
    sendActivated: true, accepted: true, activeToolCalls: 0, outcome: "failed", autoRepairAttempts: 0,
    now: new Date("2026-11-10T19:00:00.000Z") });
  expect(saved).toMatchObject({ recorded: true, classification: "response_incomplete" });
  const contents = readFileSync(saved.path, "utf8");
  expect(JSON.parse(contents)).toEqual({
    version: 1, traceId: input.traceId, createdAt: "2026-11-10T19:00:00.000Z",
    phase: "after_submission", classification: "response_incomplete", outcome: "failed",
    ...input.identity, currentAttemptSubmitted: true, priorSubmissionState: "unknown",
    priorToolEffects: "unknown", activeToolCallsObserved: 0, checkpoint: "browser_failure",
    recovery: "await_authoritative_reconciliation", autoRepairAttempts: 0,
  });
  expect(contents).not.toContain("private");
  expect(contents).not.toContain("secret");
  if (process.platform !== "win32") {
    expect(statSync(saved.path).mode & 0o777).toBe(0o600);
    expect(statSync(input.directory).mode & 0o777).toBe(0o700);
  }
}, process.platform === "win32" ? 20_000 : 5_000);

test("send activation without acknowledgement remains ambiguous and does not invent a submission", () => {
  const input = fixture();
  const saved = recordRuntimeTurnIncident({ ...input, error: error("browser_turn_owner_lost"),
    sendActivated: true, accepted: false, activeToolCalls: undefined, outcome: "failed", autoRepairAttempts: 0 });
  expect(JSON.parse(readFileSync(saved.path, "utf8"))).toMatchObject({
    phase: "send_activated", currentAttemptSubmitted: false, priorToolEffects: "unknown",
    activeToolCallsObserved: null, classification: "browser_owner_lost",
    recovery: "await_authoritative_reconciliation",
  });
});

test("a recovery response is recorded without claiming that tool effects were reconciled", () => {
  const input = fixture();
  const saved = recordRuntimeTurnIncident({ ...input, error: error("chatgpt_stalled_same_turn"),
    sendActivated: true, accepted: true, activeToolCalls: 0,
    outcome: "inband_response_completed", autoRepairAttempts: 1 });
  expect(JSON.parse(readFileSync(saved.path, "utf8"))).toMatchObject({
    classification: "response_stalled", outcome: "inband_response_completed", autoRepairAttempts: 1,
    recovery: "inband_response_completed_unverified", priorToolEffects: "unknown",
  });
  const repeat = recordRuntimeTurnIncident({ ...input, error: error("chatgpt_inband_autorepair_failed"),
    sendActivated: true, accepted: true, activeToolCalls: 3, outcome: "failed", autoRepairAttempts: 1 });
  expect(repeat.recorded).toBe(false);
  expect(readdirSync(input.directory)).toEqual([`${input.traceId}.json`]);
  expect(readFileSync(saved.path, "utf8")).not.toContain("inband_repair_failed");
});

test("untrusted error strings and native ids cannot enter journal; invalid trace cannot traverse", () => {
  const input = fixture();
  expect(classifyRuntimeFailure(new Error("My password is private"))).toBe("unclassified_browser_failure");
  expect(classifyRuntimeFailure(error("chatgpt_sign_in_required"))).toBe("authentication_or_session");
  expect(classifyRuntimeFailure(error("made_up_sensitive_code"))).toBe("adapter_failure_other");
  const saved = recordRuntimeTurnIncident({ ...input,
    identity: { threadId: "secret-private", turnId: "turn_forged" },
    error: new Error("Private message https://example.invalid/?token=123"),
    sendActivated: false, accepted: false, activeToolCalls: -9, outcome: "failed", autoRepairAttempts: 0 });
  const text = readFileSync(saved.path, "utf8");
  expect(text).not.toContain("Private");
  expect(text).not.toContain("token");
  expect(text).not.toContain("turn_forged");
  expect(JSON.parse(text).threadId).toBeUndefined();
  expect(JSON.parse(text).turnId).toBeUndefined();
  expect(JSON.parse(text).activeToolCallsObserved).toBeNull();
  expect(() => recordRuntimeTurnIncident({ ...input, traceId: "../private", error: error("chatgpt_response_incomplete"),
    sendActivated: false, accepted: false, activeToolCalls: 0, outcome: "failed", autoRepairAttempts: 0 }))
    .toThrow("Invalid runtime incident trace id");
});

test("classifies known browser, MCP and account failure codes without inspecting sensitive messages", () => {
  const examples: Partial<Record<RuntimeFailureClass, readonly string[]>> = {
    browser_observation_failure: ["browser_stream_inconsistent", "browser_dom_observation_failed"],
    submission_or_delivery_uncertain: ["chatgpt_delivery_timeout", "chatgpt_submission_ambiguous", "chatgpt_submitted_turn_failed"],
    connector_binding_failure: ["connector_not_found"],
    model_control_failure: ["chatgpt_model_controls_unavailable", "chatgpt_capabilities_stale", "chatgpt_effort_locked", "model_version_unavailable"],
    model_or_upstream_failure: ["chatgpt_stopped_thinking", "chatgpt_subscription_unavailable", "upstream_server_error"],
    upload_or_attachment_failure: ["chatgpt_attachment_unconfirmed", "chatgpt_attachment_queue_busy", "multipart_acknowledgement_mismatch", "prompt_attachment_integrity", "upload_quota_exceeded", "too_many_attachments"],
    compaction_handoff_failure: ["compaction_handoff_missing", "compaction_handoff_timeout", "compaction_control_unavailable"],
    mcp_result_pending_or_unavailable: ["codex_tool_in_progress", "codex_pending_result_unavailable"],
    authentication_or_session: ["chatgpt_session_expired", "chatgpt_sign_in_required", "chatgpt_security_check", "compaction_source_unavailable"],
    tool_or_permission_failure: ["chatgpt_tool_approval_required", "codex_tool_timeout"],
    connector_or_rate_limit: ["rate_limit_exceeded"],
  } as const;
  for (const classification of Object.keys(examples) as RuntimeFailureClass[]) {
    for (const code of examples[classification] ?? []) {
      expect(classifyRuntimeFailure(error(code, "Sensitive Authorization: Bearer abc"))).toBe(classification);
    }
  }
  // A crafted Error with a code property cannot forge a trusted adapter classification.
  const forged = Object.assign(new Error("connector_not_found"), { code: "connector_not_found" });
  expect(classifyRuntimeFailure(forged)).toBe("unclassified_browser_failure");
});

test("a stale partial pending file never masquerades as the published incident", () => {
  const input = fixture();
  mkdirSync(input.directory, { recursive: true });
  const abandoned = join(input.directory, `.${input.traceId}.000000000000000000000000.pending`);
  writeFileSync(abandoned, '{"partial":');
  const saved = recordRuntimeTurnIncident({ ...input, error: error("chatgpt_response_incomplete"),
    sendActivated: true, accepted: true, activeToolCalls: 1, outcome: "failed", autoRepairAttempts: 0 });
  expect(saved.recorded).toBe(true);
  expect(JSON.parse(readFileSync(saved.path, "utf8")).classification).toBe("response_incomplete");
  expect(readdirSync(input.directory).sort()).toEqual([`${input.traceId}.json`,
    `.${input.traceId}.000000000000000000000000.pending`].sort());
});
