import { ChatGptWebAdapterError } from "./adapter-error";
import { isNativeCodexIdentifier } from "./codex-rollout-environment";
import type { ChatGptTurnIdentity } from "./environment";
import { publishPrivateIncident } from "./private-incident-journal";

export type RuntimeFailureClass =
  | "response_stalled"
  | "response_incomplete"
  | "authentication_or_session"
  | "browser_owner_lost"
  | "browser_observation_failure"
  | "submission_or_delivery_uncertain"
  | "connector_binding_failure"
  | "model_control_failure"
  | "model_or_upstream_failure"
  | "upload_or_attachment_failure"
  | "compaction_handoff_failure"
  | "mcp_result_pending_or_unavailable"
  | "tool_or_permission_failure"
  | "connector_or_rate_limit"
  | "inband_repair_failed"
  | "adapter_failure_other"
  | "unclassified_browser_failure";

/** Persist a bounded category, never an exception message, URL, prompt or tool output. */
export function classifyRuntimeFailure(error: unknown): RuntimeFailureClass {
  if (!(error instanceof ChatGptWebAdapterError)) return "unclassified_browser_failure";
  switch (error.code) {
    case "chatgpt_stalled_same_turn": return "response_stalled";
    case "chatgpt_response_incomplete": return "response_incomplete";
    case "chatgpt_inband_autorepair_failed": return "inband_repair_failed";
    case "chatgpt_sign_in_required":
    case "chatgpt_session_expired":
    case "chatgpt_security_check":
    case "compaction_source_unavailable": return "authentication_or_session";
    case "browser_turn_owner_lost": return "browser_owner_lost";
    case "browser_stream_inconsistent":
    case "browser_dom_observation_failed": return "browser_observation_failure";
    case "chatgpt_delivery_timeout":
    case "chatgpt_submission_ambiguous":
    case "chatgpt_submitted_turn_failed": return "submission_or_delivery_uncertain";
    case "connector_not_found": return "connector_binding_failure";
    case "chatgpt_model_controls_unavailable":
    case "chatgpt_capabilities_stale":
    case "chatgpt_effort_locked":
    case "model_version_unavailable": return "model_control_failure";
    case "chatgpt_stopped_thinking":
    case "chatgpt_subscription_unavailable":
    case "upstream_server_error": return "model_or_upstream_failure";
    case "chatgpt_attachment_unconfirmed":
    case "chatgpt_attachment_queue_busy":
    case "multipart_acknowledgement_mismatch":
    case "prompt_attachment_integrity":
    case "upload_quota_exceeded":
    case "too_many_attachments": return "upload_or_attachment_failure";
    case "compaction_handoff_missing":
    case "compaction_handoff_timeout":
    case "compaction_control_unavailable": return "compaction_handoff_failure";
    case "codex_tool_in_progress":
    case "codex_pending_result_unavailable": return "mcp_result_pending_or_unavailable";
    case "chatgpt_tool_approval_required":
    case "codex_tool_timeout": return "tool_or_permission_failure";
    case "rate_limit_exceeded": return "connector_or_rate_limit";
    default: return "adapter_failure_other";
  }
}

export interface RuntimeTurnIncident {
  version: 1;
  traceId: string;
  createdAt: string;
  phase: "before_send" | "send_activated" | "after_submission";
  classification: RuntimeFailureClass;
  outcome: "failed" | "inband_response_completed";
  threadId?: string;
  turnId?: string;
  /** Send activation is ambiguous even without proof of acceptance. */
  currentAttemptSubmitted: boolean;
  priorSubmissionState: "unknown";
  priorToolEffects: "unknown";
  activeToolCallsObserved: number | null;
  checkpoint: "browser_failure" | "inband_response_completed";
  recovery: "await_authoritative_reconciliation" | "inband_response_completed_unverified";
  autoRepairAttempts: 0 | 1;
}

/**
 * One journal per trace. A later observer cannot rewrite an incident from another process.
 * Nothing here attests that previously dispatched MCP operations are safe to repeat.
 */
export function recordRuntimeTurnIncident(input: {
  directory: string;
  traceId: string;
  identity?: ChatGptTurnIdentity;
  error: unknown;
  sendActivated: boolean;
  accepted: boolean;
  activeToolCalls: number | undefined;
  outcome: RuntimeTurnIncident["outcome"];
  autoRepairAttempts: 0 | 1;
  now?: Date;
}): { path: string; recorded: boolean; classification: RuntimeFailureClass } {
  if (!/^[0-9a-f]{12}$/.test(input.traceId)) throw new Error("Invalid runtime incident trace id");
  const classification = classifyRuntimeFailure(input.error);
  const incident: RuntimeTurnIncident = {
    version: 1,
    traceId: input.traceId,
    createdAt: (input.now ?? new Date()).toISOString(),
    phase: input.accepted ? "after_submission" : input.sendActivated ? "send_activated" : "before_send",
    classification,
    outcome: input.outcome,
    ...(isNativeCodexIdentifier(input.identity?.threadId) ? { threadId: input.identity?.threadId } : {}),
    ...(isNativeCodexIdentifier(input.identity?.turnId) ? { turnId: input.identity?.turnId } : {}),
    currentAttemptSubmitted: input.accepted,
    priorSubmissionState: "unknown",
    priorToolEffects: "unknown",
    activeToolCallsObserved: Number.isSafeInteger(input.activeToolCalls) && input.activeToolCalls! >= 0
      ? input.activeToolCalls! : null,
    checkpoint: input.outcome === "failed" ? "browser_failure" : "inband_response_completed",
    recovery: input.outcome === "failed"
      ? "await_authoritative_reconciliation" : "inband_response_completed_unverified",
    autoRepairAttempts: input.autoRepairAttempts,
  };
  return { ...publishPrivateIncident(input.directory, input.traceId, incident), classification };
}
