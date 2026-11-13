import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { publishPrivateBrokerEvent } from "./private-incident-journal";

/** An observation boundary, not proof of a tool's side effect or a replay grant. */
export type BrokerCallEvent = "queued" | "delivery_possible" | "result_received"
  | "compaction_resolution_possible" | "retired_uncertain";

export interface BrokerOperationStatusContract {
  statusTool: string;
  operationIdArgument: string;
  providerEpochArgument: string;
  waitSecondsArgument?: string;
  effectScope: string;
}

const OPERATION_STATUS_TOOL_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/;
const OPERATION_STATUS_ARGUMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const OPERATION_STATUS_SCOPE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export function isBrokerOperationStatusContract(value: unknown): value is BrokerOperationStatusContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const contract = value as Record<string, unknown>;
  const keys = Object.keys(contract).sort().join(",");
  const expectedKeys = ["effectScope", "operationIdArgument", "providerEpochArgument", "statusTool",
    ...(contract.waitSecondsArgument === undefined ? [] : ["waitSecondsArgument"])].sort().join(",");
  if (keys !== expectedKeys) return false;
  if (typeof contract.statusTool !== "string" || !OPERATION_STATUS_TOOL_PATTERN.test(contract.statusTool)
    || typeof contract.operationIdArgument !== "string" || !OPERATION_STATUS_ARGUMENT_PATTERN.test(contract.operationIdArgument)
    || typeof contract.providerEpochArgument !== "string" || !OPERATION_STATUS_ARGUMENT_PATTERN.test(contract.providerEpochArgument)
    || typeof contract.effectScope !== "string" || !OPERATION_STATUS_SCOPE_PATTERN.test(contract.effectScope)) return false;
  if (contract.waitSecondsArgument !== undefined
    && (typeof contract.waitSecondsArgument !== "string"
      || !OPERATION_STATUS_ARGUMENT_PATTERN.test(contract.waitSecondsArgument))) return false;
  const argumentsList = [contract.operationIdArgument, contract.providerEpochArgument,
    ...(typeof contract.waitSecondsArgument === "string" ? [contract.waitSecondsArgument] : [])];
  return new Set(argumentsList).size === argumentsList.length;
}

export interface BrokerCallEvidence {
  version: 1;
  traceId: string;
  callId: string;
  tool: string;
  /** SHA-256 of the native thread/turn pair when the owner supplied both valid IDs. */
  nativeOwnerDigest?: string;
  /** Explicit provider declaration captured at dispatch; absent legacy entries are treated as mutating. */
  readOnly?: boolean;
  /** Provider ledger epoch advertised by an opted-in tool schema. */
  providerEpoch?: string;
  /** Provider-declared read-only status tool captured when the operation was queued. */
  operationStatus?: BrokerOperationStatusContract;
  event: BrokerCallEvent;
  recordedAt: string;
  /** The only result state durable here; content and tool arguments are deliberately excluded. */
  resultRecoverable: false;
  replayAuthorized: false;
}

/**
 * First-writer-wins state transition journal. An event is synced before the broker crosses its
 * boundary. A crash between delivery_possible and actual execution intentionally remains unknown.
 * Neither an event nor an opaque call ID is an authorization to invoke a tool after restart.
 */
export function recordBrokerCallEvent(input: {
  directory: string;
  traceId: string;
  callId: string;
  wireName: string;
  event: BrokerCallEvent;
  nativeOwnerDigest?: string;
  readOnly?: boolean;
  providerEpoch?: string;
  operationStatus?: BrokerOperationStatusContract;
  now?: Date;
}): { path: string; recorded: boolean } {
  if (!/^[0-9a-f]{12}$/.test(input.traceId)) throw new Error("Invalid broker trace id");
  if (!/^call_[A-Za-z0-9_-]{32}$/.test(input.callId)) throw new Error("Invalid broker call id");
  if (input.nativeOwnerDigest !== undefined && !/^[0-9a-f]{64}$/.test(input.nativeOwnerDigest)) {
    throw new Error("Invalid broker native owner digest");
  }
  if (input.readOnly !== undefined && typeof input.readOnly !== "boolean") {
    throw new Error("Invalid broker read-only declaration");
  }
  if (input.providerEpoch !== undefined && !/^[0-9a-f]{32}$/.test(input.providerEpoch)) {
    throw new Error("Invalid broker provider epoch");
  }
  if (input.operationStatus !== undefined && !isBrokerOperationStatusContract(input.operationStatus)) {
    throw new Error("Invalid broker operation status contract");
  }
  const tool = /^[A-Za-z0-9_.:-]{1,256}$/.test(input.wireName)
    ? input.wireName : "unclassified_tool";
  const key = createHash("sha256").update(`v1:${input.callId}:${input.event}`).digest("hex");
  const entry: BrokerCallEvidence = {
    version: 1,
    traceId: input.traceId,
    callId: input.callId,
    tool,
    ...(input.nativeOwnerDigest ? { nativeOwnerDigest: input.nativeOwnerDigest } : {}),
    ...(input.readOnly !== undefined ? { readOnly: input.readOnly } : {}),
    ...(input.providerEpoch ? { providerEpoch: input.providerEpoch } : {}),
    ...(input.operationStatus ? { operationStatus: input.operationStatus } : {}),
    event: input.event,
    recordedAt: (input.now ?? new Date()).toISOString(),
    resultRecoverable: false,
    replayAuthorized: false,
  };
  const saved = publishPrivateBrokerEvent(join(input.directory, input.traceId), key, entry);
  if (!saved.recorded) {
    // A retry can acknowledge an existing boundary only if its entire durable record is valid.
    // A tampered flag or extra field must not be accepted by the live broker.
    const stat = lstatSync(saved.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 4_096) {
      throw new Error("Conflicting broker call journal event");
    }
    let prior: Partial<BrokerCallEvidence>;
    try { prior = JSON.parse(readFileSync(saved.path, "utf8")) as Partial<BrokerCallEvidence>; }
    catch { throw new Error("Conflicting broker call journal event"); }
    if (!prior || typeof prior !== "object" || Array.isArray(prior)
      || Object.keys(prior).sort().join(",") !== Object.keys(entry).sort().join(",")
      || prior.version !== 1 || prior.traceId !== entry.traceId || prior.callId !== entry.callId
      || prior.event !== entry.event || prior.tool !== entry.tool
      || prior.nativeOwnerDigest !== entry.nativeOwnerDigest
      || prior.readOnly !== entry.readOnly
      || prior.providerEpoch !== entry.providerEpoch
      || !isDeepStrictEqual(prior.operationStatus, entry.operationStatus)
      || prior.resultRecoverable !== false || prior.replayAuthorized !== false
      || typeof prior.recordedAt !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(prior.recordedAt)
      || Number.isNaN(Date.parse(prior.recordedAt))
      || new Date(prior.recordedAt).toISOString() !== prior.recordedAt) {
      throw new Error("Conflicting broker call journal event");
    }
  }
  return saved;
}
