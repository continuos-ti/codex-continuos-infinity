import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { namespacedToolName, type CodexMessage, type CodexTool, type CodexToolCall, type CodexToolResultMessage } from "../../types";
import type { BrokerRecoveryCall } from "./broker-call-reconciliation";
import { attachBrokerOperationId, brokerOperationStatusForTool, brokerOperationStatusQueryForCall, brokerProviderEpochForTool, brokerToolIsReadOnly } from "./broker-operation-identity";
import type { BrokerToolRequest } from "./turn-broker";

export interface BrokerProviderRecoveryCheck {
  originalCallId: string;
  state: BrokerRecoveryCall["state"];
  effectScope: string;
  providerEpoch: string;
  request: BrokerToolRequest;
}

/** Prepare stable native read-only calls. A stopped broker never receives a new capability. */
export function prepareBrokerProviderRecoveryChecks(
  calls: readonly BrokerRecoveryCall[],
  tools: CodexTool[],
  limit = 16,
): BrokerProviderRecoveryCheck[] {
  if (!Number.isSafeInteger(limit) || limit < 1) return [];
  const seenCallIds = new Set<string>();
  const ambiguousCallIds = new Set<string>();
  for (const call of calls) {
    if (seenCallIds.has(call.callId)) ambiguousCallIds.add(call.callId);
    seenCallIds.add(call.callId);
  }
  const checks: BrokerProviderRecoveryCheck[] = [];
  for (const call of calls) {
    // A call ID appearing in multiple traces cannot identify one provider operation.
    if (ambiguousCallIds.has(call.callId)) continue;
    const query = brokerOperationStatusQueryForCall(call, tools);
    if (!query || !call.providerEpoch) continue;
    try {
      if (!brokerToolIsReadOnly(query.wireName, tools)) continue;
      const checkId = `call_${createHash("sha256").update("broker-provider-status-v1\0")
        .update(JSON.stringify({ originalCallId: call.callId, query })).digest("hex").slice(0, 32)}`;
      const request = attachBrokerOperationId({
        callId: checkId,
        wireName: query.wireName,
        freeform: false,
        readOnly: true,
        providerEpoch: brokerProviderEpochForTool(query.wireName, tools),
        operationStatus: brokerOperationStatusForTool(query.wireName, tools),
        arguments: query.arguments,
      }, tools);
      checks.push({ originalCallId: call.callId, state: call.state,
        effectScope: query.effectScope, providerEpoch: call.providerEpoch, request });
    } catch {
      // A changed or ambiguous provider declaration cannot authorize a status tool call.
      continue;
    }
    if (checks.length >= limit) break;
  }
  return checks;
}

export interface BrokerProviderRecoveryObservation {
  callId: string;
  state: BrokerRecoveryCall["state"];
  effectScope: string;
  providerStatus: string;
  exitCode?: number;
}

/** Continue bounded read-only queries after partial native replies. */
export function pendingBrokerProviderRecoveryChecks(
  checks: readonly BrokerProviderRecoveryCheck[],
  messages: readonly CodexMessage[],
  limit = 16,
): BrokerProviderRecoveryCheck[] {
  if (!Number.isSafeInteger(limit) || limit < 1) return [];
  const dispatched = new Set<string>();
  for (const message of messages) {
    if (message.role === "toolResult") dispatched.add(message.toolCallId);
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type === "toolCall") dispatched.add(part.id);
      }
    }
  }
  // A native call without a result is still in flight. Never emit its ID again.
  return checks.filter(check => !dispatched.has(check.request.callId)).slice(0, limit);
}

const PROVIDER_STATUSES = new Set([
  "starting", "running", "completed", "launch_failed", "unknown", "provider_changed", "not_found", "epoch_required",
]);

/** Extract only bounded status metadata from native tool results, never command output. */
export function observeBrokerProviderRecoveryChecks(
  checks: readonly BrokerProviderRecoveryCheck[],
  messages: readonly CodexMessage[],
): { received: number; observations: BrokerProviderRecoveryObservation[] } {
  const byId = new Map<string, CodexToolResultMessage[]>();
  const nativeCalls = new Map<string, CodexToolCall[]>();
  for (const message of messages) {
    if (message.role === "toolResult") {
      const existing = byId.get(message.toolCallId) ?? [];
      existing.push(message);
      byId.set(message.toolCallId, existing);
    } else if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type !== "toolCall") continue;
        const existing = nativeCalls.get(part.id) ?? [];
        existing.push(part);
        nativeCalls.set(part.id, existing);
      }
    }
  }
  const observations: BrokerProviderRecoveryObservation[] = [];
  let received = 0;
  for (const check of checks) {
    const results = byId.get(check.request.callId) ?? [];
    if (results.length === 0) continue;
    received += results.length;
    const observation: BrokerProviderRecoveryObservation = {
      callId: check.originalCallId,
      state: check.state,
      effectScope: check.effectScope,
      providerStatus: "unverified",
    };
    const message = results.length === 1 ? results[0] : undefined;
    const native = nativeCalls.get(check.request.callId) ?? [];
    const issued = native.length === 1
      && namespacedToolName(native[0].namespace, native[0].name) === check.request.wireName
      && isDeepStrictEqual(native[0].arguments, check.request.arguments ?? {});
    if (issued && message && !message.isError
      && namespacedToolName(message.toolNamespace, message.toolName) === check.request.wireName) {
      try {
        const text = typeof message.content === "string" ? message.content
          : message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
        const value: unknown = JSON.parse(text);
        const record = value && typeof value === "object" && !Array.isArray(value)
          ? value as Record<string, unknown> : undefined;
        const nested = record?.result && typeof record.result === "object" && !Array.isArray(record.result)
          ? record.result as Record<string, unknown> : record;
        const providerChanged = nested?.status === "provider_changed";
        const matchingEpoch = nested?.provider_epoch === check.providerEpoch;
        const changedEpoch = typeof nested?.provider_epoch === "string"
          && /^[0-9a-f]{32}$/.test(nested.provider_epoch)
          && nested.provider_epoch !== check.providerEpoch;
        const completedWithExitCode = nested?.status !== "completed"
          || Number.isSafeInteger(nested.exit_code);
        if (nested && (nested.job_id === check.originalCallId || nested.operation_id === check.originalCallId)
          && (providerChanged ? changedEpoch : matchingEpoch)
          && completedWithExitCode
          && typeof nested.status === "string" && PROVIDER_STATUSES.has(nested.status)) {
          observation.providerStatus = nested.status;
          if (nested.status === "completed") {
            observation.exitCode = nested.exit_code as number;
          }
        }
      } catch {
        // Malformed or non-JSON tool output cannot establish any provider state.
      }
    }
    observations.push(observation);
  }
  return { received, observations };
}
