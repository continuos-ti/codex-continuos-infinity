import { isDeepStrictEqual } from "node:util";
import { namespacedToolName, type CodexTool } from "../../types";
import { isBrokerOperationStatusContract, type BrokerOperationStatusContract } from "./broker-call-journal";
import type { BrokerToolRequest } from "./turn-broker";

const OPERATION_ID_EXTENSION = "x-codex-operation-id";
const PROVIDER_EPOCH_EXTENSION = "x-codex-provider-epoch";
const OPERATION_STATUS_EXTENSION = "x-codex-operation-status";
const READ_ONLY_EXTENSION = "x-codex-read-only";
const OPERATION_ID_PATTERN = /^call_[A-Za-z0-9_-]{32}$/;
const PROVIDER_EPOCH_PATTERN = /^[0-9a-f]{32}$/;

export interface BrokerOperationStatusQuery {
  wireName: string;
  arguments: Record<string, unknown>;
  effectScope: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Only an explicit structured provider declaration can classify a tool as read-only. */
export function brokerToolIsReadOnly(wireName: string, tools: CodexTool[]): boolean {
  const tool = tools.find(candidate =>
    namespacedToolName(candidate.namespace, candidate.name) === wireName);
  if (!tool || tool.freeform || tool.toolSearch) return false;
  const parameters = asRecord(tool.parameters);
  return parameters?.type === "object"
    && asRecord(parameters.properties) !== undefined
    && parameters[READ_ONLY_EXTENSION] === true;
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

/** Resolve a provider-declared read-only status tool for a durable operation. */
export function brokerOperationStatusForTool(
  wireName: string,
  tools: CodexTool[],
): BrokerOperationStatusContract | undefined {
  const tool = tools.find(candidate =>
    namespacedToolName(candidate.namespace, candidate.name) === wireName);
  const parameters = asRecord(tool?.parameters);
  const declarationValue = parameters?.[OPERATION_STATUS_EXTENSION];
  if (declarationValue === undefined) return undefined;
  const declaration = asRecord(declarationValue);
  if (!tool || tool.freeform || tool.toolSearch || parameters?.[OPERATION_ID_EXTENSION] !== true) {
    throw new Error("Codex tool " + wireName + " advertises operation status without a structured operation ID");
  }

  const providerEpoch = brokerProviderEpochForTool(wireName, tools);
  const operationIdSchema = asRecord(asRecord(parameters.properties)?.operation_id);
  const operationRequired = parameters.required;
  if (!providerEpoch || operationIdSchema?.type !== "string" || !declaration
    || !Array.isArray(operationRequired)
    || !operationRequired.includes("operation_id")
    || !operationRequired.includes("provider_epoch")) {
    throw new Error("Codex tool " + wireName + " advertises an invalid operation status contract");
  }

  const declarationKeys = Object.keys(declaration).sort().join(",");
  if (declarationKeys !== ["effect_scope", "operation_id_argument", "provider_epoch_argument", "status_tool"]
    .sort().join(",")
    && declarationKeys !== ["effect_scope", "operation_id_argument", "provider_epoch_argument", "status_tool", "wait_seconds_argument"]
      .sort().join(",")) {
    throw new Error("Codex tool " + wireName + " advertises an invalid operation status declaration");
  }

  const statusToolName = declaration.status_tool;
  if (typeof statusToolName !== "string" || !/^[A-Za-z0-9_.:-]{1,256}$/.test(statusToolName)) {
    throw new Error("Codex tool " + wireName + " advertises an invalid operation status tool name");
  }
  const statusTools = tools.filter(candidate => candidate.namespace === tool.namespace
    && (candidate.name === statusToolName || candidate.name === `_${statusToolName}`));
  if (statusTools.length !== 1) {
    throw new Error("Codex tool " + wireName + " operation status tool is missing or ambiguous");
  }
  const statusTool = statusTools[0]!;
  const statusParameters = asRecord(statusTool.parameters);
  const statusProperties = asRecord(statusParameters?.properties);
  const operationIdArgument = declaration.operation_id_argument;
  const providerEpochArgument = declaration.provider_epoch_argument;
  const waitSecondsArgument = declaration.wait_seconds_argument;
  const required = Array.isArray(statusParameters?.required) ? statusParameters.required : [];
  if (statusTool.freeform || statusTool.toolSearch || statusParameters?.type !== "object"
    || statusParameters?.[READ_ONLY_EXTENSION] !== true
    || typeof operationIdArgument !== "string" || typeof providerEpochArgument !== "string"
    || asRecord(statusProperties?.[operationIdArgument])?.type !== "string"
    || asRecord(statusProperties?.[providerEpochArgument])?.type !== "string"
    || !required.includes(operationIdArgument)
    || !required.includes(providerEpochArgument)
    || required.some(argument => typeof argument !== "string"
      || ![operationIdArgument, providerEpochArgument, waitSecondsArgument].includes(argument))) {
    throw new Error("Codex tool " + wireName + " operation status tool is not a validated read-only query");
  }
  const waitSchema = typeof waitSecondsArgument === "string"
    ? asRecord(statusProperties?.[waitSecondsArgument]) : undefined;
  if (waitSecondsArgument !== undefined
    && (typeof waitSecondsArgument !== "string"
      || !["integer", "number"].includes(String(waitSchema?.type))
      || (typeof waitSchema?.minimum === "number" && waitSchema.minimum > 0)
      || (typeof waitSchema?.exclusiveMinimum === "number" && waitSchema.exclusiveMinimum >= 0)
      || (Array.isArray(waitSchema?.enum) && !waitSchema.enum.includes(0))
      || (waitSchema?.const !== undefined && waitSchema.const !== 0))) {
    throw new Error("Codex tool " + wireName + " operation status wait argument is invalid");
  }

  const contract = {
    statusTool: namespacedToolName(statusTool.namespace, statusTool.name),
    operationIdArgument,
    providerEpochArgument,
    ...(typeof waitSecondsArgument === "string" ? { waitSecondsArgument } : {}),
    effectScope: declaration.effect_scope,
  };
  if (!isBrokerOperationStatusContract(contract)) {
    throw new Error("Codex tool " + wireName + " advertises an invalid operation status contract");
  }
  return contract;
}

/** Build a read-only provider status query only when the current provider contract still matches the journal. */
export function brokerOperationStatusQueryForCall(
  call: { callId: string; tool: string; providerEpoch?: string; operationStatus?: BrokerOperationStatusContract },
  tools: CodexTool[],
): BrokerOperationStatusQuery | undefined {
  if (!OPERATION_ID_PATTERN.test(call.callId) || !call.providerEpoch || !call.operationStatus) return undefined;
  let providerEpoch: string | undefined;
  let operationStatus: BrokerOperationStatusContract | undefined;
  try {
    providerEpoch = brokerProviderEpochForTool(call.tool, tools);
    operationStatus = brokerOperationStatusForTool(call.tool, tools);
  } catch {
    // A changed or malformed live provider cannot supply a trusted recovery query.
    return undefined;
  }
  if (providerEpoch !== call.providerEpoch || !isDeepStrictEqual(operationStatus, call.operationStatus)) return undefined;

  const arguments_: Record<string, unknown> = {
    [call.operationStatus.operationIdArgument]: call.callId,
    [call.operationStatus.providerEpochArgument]: call.providerEpoch,
  };
  if (call.operationStatus.waitSecondsArgument) arguments_[call.operationStatus.waitSecondsArgument] = 0;
  return {
    wireName: call.operationStatus.statusTool,
    arguments: arguments_,
    effectScope: call.operationStatus.effectScope,
  };
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
  const operationStatus = brokerOperationStatusForTool(request.wireName, tools);
  if (request.providerEpoch !== providerEpoch) {
    throw new Error("Codex tool " + request.wireName + " provider epoch changed while the broker call was queued");
  }
  if (!isDeepStrictEqual(request.operationStatus, operationStatus)) {
    throw new Error("Codex tool " + request.wireName + " operation status contract changed while the broker call was queued");
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
