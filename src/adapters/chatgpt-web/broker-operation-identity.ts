import { namespacedToolName, type CodexTool } from "../../types";
import type { BrokerToolRequest } from "./turn-broker";

const OPERATION_ID_EXTENSION = "x-codex-operation-id";
const PROVIDER_EPOCH_EXTENSION = "x-codex-provider-epoch";
const OPERATION_ID_PATTERN = /^call_[A-Za-z0-9_-]{32}$/;
const PROVIDER_EPOCH_PATTERN = /^[0-9a-f]{32}$/;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function brokerProviderEpochForTool(wireName: string, tools: CodexTool[]): string | undefined {
  const tool = tools.find(candidate =>
    namespacedToolName(candidate.namespace, candidate.name) === wireName);
  const parameters = asRecord(tool?.parameters);
  const providerEpoch = parameters?.[PROVIDER_EPOCH_EXTENSION];
  if (providerEpoch === undefined) return undefined;

  const properties = asRecord(parameters?.properties);
  const providerEpochSchema = asRecord(properties?.provider_epoch);
  if (typeof providerEpoch !== "string" || !PROVIDER_EPOCH_PATTERN.test(providerEpoch)
    || providerEpochSchema?.type !== "string") {
    throw new Error("Codex tool " + wireName + " advertises an invalid provider epoch");
  }
  return providerEpoch;
}

/**
 * Pass the durable broker call identity to providers that explicitly advertise
 * the x-codex-operation-id JSON Schema extension.
 */
export function attachBrokerOperationId(
  request: BrokerToolRequest,
  tools: CodexTool[],
): BrokerToolRequest {
  if (request.freeform) return request;

  const tool = tools.find(candidate =>
    namespacedToolName(candidate.namespace, candidate.name) === request.wireName);
  const parameters = asRecord(tool?.parameters);
  const properties = asRecord(parameters?.properties);
  const hasOperationId = parameters?.[OPERATION_ID_EXTENSION] === true;
  const providerEpoch = brokerProviderEpochForTool(request.wireName, tools);
  if (request.providerEpoch !== providerEpoch) {
    throw new Error("Codex tool " + request.wireName + " provider epoch changed while the broker call was queued");
  }
  if (!hasOperationId && providerEpoch === undefined) return request;

  const argumentsWithIdentity = { ...(request.arguments ?? {}) };
  if (hasOperationId) {
    const operationIdSchema = asRecord(properties?.operation_id);
    if (operationIdSchema?.type !== "string") {
      throw new Error(
        "Codex tool " + request.wireName + " advertises broker operation IDs without a string operation_id property",
      );
    }
    if (!OPERATION_ID_PATTERN.test(request.callId)) {
      throw new Error("Codex broker call has an invalid operation identity for " + request.wireName);
    }
    argumentsWithIdentity.operation_id = request.callId;
  }

  if (providerEpoch !== undefined) {
    argumentsWithIdentity.provider_epoch = providerEpoch;
  }

  return {
    ...request,
    arguments: argumentsWithIdentity,
  };
}
