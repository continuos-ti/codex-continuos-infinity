import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { publishPrivateBrokerEvent } from "./private-incident-journal";

/** An observation boundary, not proof of a tool's side effect or a replay grant. */
export type BrokerCallEvent = "queued" | "delivery_possible" | "result_received"
  | "compaction_resolution_possible" | "retired_uncertain";

export interface BrokerCallEvidence {
  version: 1;
  traceId: string;
  callId: string;
  tool: string;
  /** SHA-256 of the native thread/turn pair when the owner supplied both valid IDs. */
  nativeOwnerDigest?: string;
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
  now?: Date;
}): { path: string; recorded: boolean } {
  if (!/^[0-9a-f]{12}$/.test(input.traceId)) throw new Error("Invalid broker trace id");
  if (!/^call_[A-Za-z0-9_-]{32}$/.test(input.callId)) throw new Error("Invalid broker call id");
  if (input.nativeOwnerDigest !== undefined && !/^[0-9a-f]{64}$/.test(input.nativeOwnerDigest)) {
    throw new Error("Invalid broker native owner digest");
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
    event: input.event,
    recordedAt: (input.now ?? new Date()).toISOString(),
    resultRecoverable: false,
    replayAuthorized: false,
  };
  const saved = publishPrivateBrokerEvent(join(input.directory, input.traceId), key, entry);
  if (!saved.recorded) {
    // A retry of the same boundary may be legitimate. A mismatched entry never is.
    const prior = JSON.parse(readFileSync(saved.path, "utf8")) as Partial<BrokerCallEvidence>;
    if (prior.version !== 1 || prior.traceId !== entry.traceId || prior.callId !== entry.callId
      || prior.event !== entry.event || prior.tool !== entry.tool
      || prior.nativeOwnerDigest !== entry.nativeOwnerDigest) {
      throw new Error("Conflicting broker call journal event");
    }
  }
  return saved;
}
