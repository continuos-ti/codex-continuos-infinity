import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { namespacedToolName, type CodexMessage, type CodexTool, type CodexToolCall, type CodexToolResultMessage } from "../../types";
import type { BrokerRecoveryCall } from "./broker-call-reconciliation";
import type { BrokerOperationStatusContract } from "./broker-call-journal";
import { attachBrokerOperationId, brokerOperationStatusForTool, brokerOperationStatusQueryForCall, brokerProviderEpochForTool, brokerToolIsReadOnly } from "./broker-operation-identity";
import type { BrokerToolRequest } from "./turn-broker";

export interface BrokerProviderRecoveryCheck {
  originalCallId: string;
  originalTool: string;
  originalOperationStatus: BrokerOperationStatusContract;
  state: BrokerRecoveryCall["state"];
  effectScope: string;
  providerEpoch: string;
  /** The original provider explicitly offered an optional read-only wait parameter. */
  waitSecondsArgument?: string;
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
      checks.push({ originalCallId: call.callId, originalTool: call.tool,
        originalOperationStatus: call.operationStatus!, state: call.state,
        effectScope: query.effectScope, providerEpoch: call.providerEpoch,
        ...(call.operationStatus?.waitSecondsArgument
          ? { waitSecondsArgument: call.operationStatus.waitSecondsArgument } : {}), request });
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

/** Continue read-only queries without exceeding the outstanding native call budget. */
export function pendingBrokerProviderRecoveryChecks(
  checks: readonly BrokerProviderRecoveryCheck[],
  messages: readonly CodexMessage[],
  limit = 16,
): BrokerProviderRecoveryCheck[] {
  if (!Number.isSafeInteger(limit) || limit < 1) return [];
  const issued = new Set<string>();
  const received = new Set<string>();
  for (const message of messages) {
    if (message.role === "toolResult") received.add(message.toolCallId);
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type === "toolCall") issued.add(part.id);
      }
    }
  }
  // Only this recovery set consumes its limit. Issued calls without native results
  // occupy slots until their replies arrive; neither result-less calls nor replies
  // without a matching issue may cause an operation ID to be emitted again.
  const outstanding = checks.reduce((count, check) => count + (
    issued.has(check.request.callId) && !received.has(check.request.callId) ? 1 : 0
  ), 0);
  return checks.filter(check => !issued.has(check.request.callId)
    && !received.has(check.request.callId)).slice(0, Math.max(0, limit - outstanding));
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
        // A provider may use either name, but conflicting echoed IDs cannot identify
        // the original operation. Do not accept a matching job_id alongside an unrelated
        // operation_id (or the reverse), including when the tool wraps its result.
        const echoedIds = nested ? [nested.job_id, nested.operation_id]
          .filter(value => value !== undefined) : [];
        const outer = nested !== record ? record : undefined;
        const outerIds = outer ? [outer.job_id, outer.operation_id]
          .filter(value => value !== undefined) : [];
        const idsConsistent = echoedIds.length > 0
          && [...echoedIds, ...outerIds].every(value => value === check.originalCallId);
        const outerEpochConsistent = outer?.provider_epoch === undefined
          || outer.provider_epoch === nested?.provider_epoch;
        // Any extra status on a wrapper is an independent execution claim. An
        // unrecognized value (including an error state) cannot silently endorse
        // a nested "completed" result. Fail closed on disagreement or bad types.
        const outerStatusConsistent = outer?.status === undefined
          || outer.status === nested?.status;
        const outerExitConsistent = outer?.exit_code === undefined
          || outer.exit_code === nested?.exit_code;
        // A provider may report a terminal status alongside an explicit failure in
        // the status body itself. Those flags must be checked in both envelopes.
        const nestedFailureAbsent = (nested?.ok === undefined || nested.ok === true)
          && (nested?.success === undefined || nested.success === true)
          && (nested?.error === undefined || nested.error === null);
        const outerFailureAbsent = (outer?.ok === undefined || outer.ok === true)
          && (outer?.success === undefined || outer.success === true)
          && (outer?.error === undefined || outer.error === null);
        if (nested && idsConsistent && outerEpochConsistent && outerStatusConsistent && outerExitConsistent
          && nestedFailureAbsent && outerFailureAbsent
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

/** Only an unambiguous, advertised integer range authorizes a blocking status poll. */
function providerPollWaitSeconds(check: BrokerProviderRecoveryCheck, tools: readonly CodexTool[]): number {
  const argument = check.waitSecondsArgument;
  if (!argument || ![0, 10].includes(check.request.arguments?.[argument] as number)) return 0;
  const matches = tools.filter(tool => namespacedToolName(tool.namespace, tool.name) === check.request.wireName);
  if (matches.length !== 1) return 0;
  const parameters = matches[0]!.parameters;
  const properties = parameters.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return 0;
  const declaration = (properties as Record<string, unknown>)[argument];
  if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) return 0;
  const schema = declaration as Record<string, unknown>;
  // An unfamiliar constraint might exclude 10. Fall back to the validated zero-wait query.
  if (Object.keys(schema).some(key => !["type", "minimum", "maximum", "default", "title", "description"].includes(key))) return 0;
  return schema.type === "integer"
    && typeof schema.minimum === "number" && schema.minimum <= 10
    && typeof schema.maximum === "number" && schema.maximum >= 10 ? 10 : 0;
}

/**
 * Schedule bounded new *read-only status checks* after verified running/starting replies.
 * Their IDs are stable across native round retries. Never reissue an original command or a
 * check whose native result is outstanding, stale, ambiguous or from another provider epoch.
 */
export function extendBrokerProviderRecoveryChecks(
  initialChecks: readonly BrokerProviderRecoveryCheck[],
  messages: readonly CodexMessage[],
  tools: readonly CodexTool[],
  maxAttempts = 12,
): BrokerProviderRecoveryCheck[] {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 12) return [...initialChecks];
  const allChecks = [...initialChecks];
  const latest = [...initialChecks];
  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    let added = 0;
    for (let index = 0; index < latest.length; index++) {
      const previous = latest[index]!;
      const observed = observeBrokerProviderRecoveryChecks([previous], messages).observations[0];
      if (observed?.providerStatus !== "running" && observed?.providerStatus !== "starting") continue;
      // A status contract can change while the native turn is polling. Every new
      // request must still be authorized by the original operation's live provider.
      const liveQuery = brokerOperationStatusQueryForCall({
        callId: previous.originalCallId, tool: previous.originalTool,
        providerEpoch: previous.providerEpoch,
        operationStatus: previous.originalOperationStatus,
      }, [...tools]);
      if (!liveQuery || liveQuery.wireName !== previous.request.wireName
        || liveQuery.effectScope !== previous.effectScope) continue;
      const newId = `call_${createHash("sha256").update("broker-provider-status-followup-v1\0")
        .update(initialChecks[index]!.request.callId).update("\0")
        .update(String(attempt)).digest("hex").slice(0, 32)}`;
      const args = { ...(previous.request.arguments ?? {}) };
      // A status provider may itself declare x-codex-operation-id.
      if (args.operation_id === previous.request.callId) args.operation_id = newId;
      if (previous.waitSecondsArgument && [0, 10].includes(args[previous.waitSecondsArgument] as number)) {
        args[previous.waitSecondsArgument] = providerPollWaitSeconds(previous, tools);
      }
      const nextRequest = { ...previous.request, callId: newId, arguments: args };
      try {
        if (!brokerToolIsReadOnly(nextRequest.wireName, [...tools])
          || !isDeepStrictEqual(attachBrokerOperationId(nextRequest, [...tools]), nextRequest)) continue;
      } catch {
        // A changed status provider cannot authorize another read-only poll.
        continue;
      }
      const next = { ...previous, request: nextRequest };
      latest[index] = next;
      allChecks.push(next);
      added++;
    }
    if (added === 0) break;
  }
  return allChecks;
}
