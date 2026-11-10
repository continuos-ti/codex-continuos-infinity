import { ChatGptWebAdapterError } from "./adapter-error";
import { isNativeCodexIdentifier } from "./codex-rollout-environment";
import type { ChatGptTurnIdentity } from "./environment";
import { publishPrivateIncident } from "./private-incident-journal";

export type RuntimeFailureClass =
  | "response_stalled"
  | "response_incomplete"
  | "authentication_or_session"
  | "browser_owner_lost"
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
    case "compaction_source_unavailable": return "authentication_or_session";
    case "browser_turn_owner_lost": return "browser_owner_lost";
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
