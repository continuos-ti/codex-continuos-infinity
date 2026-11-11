import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BrokerCallEvent, BrokerCallEvidence } from "./broker-call-journal";

const EVENTS = new Set<BrokerCallEvent>([
  "queued", "delivery_possible", "result_received", "compaction_resolution_possible", "retired_uncertain",
]);
const MAX_RECORDS = 20_000;
const MAX_RECORD_BYTES = 4_096;
const MAX_TRACES = 20_000;
const MAX_PENDING_FILES = 20_000;

export type BrokerRecoveryState = "queued_unconfirmed" | "delivery_unknown"
  | "result_unavailable" | "compaction_resolution_unavailable" | "retired_uncertain";

export interface BrokerRecoveryCall {
  traceId: string;
  callId: string;
  tool: string;
  state: BrokerRecoveryState;
  /** Reconciliation is observational. It cannot grant a new capability after process death. */
  resultRecoverable: false;
  replayAuthorized: false;
}

function invalid(): never {
  throw new Error("Broker call reconciliation found invalid or inconsistent evidence; recovery requires manual review");
}

/**
 * Read a stopped broker's durable observation boundaries. The live owner, payloads and result
 * promises are gone after a crash. Even result_received means only that an owner presented a
 * result; its content was not persisted, and its effect cannot be inferred from this journal.
 * No state returned here licenses re-execution, continuation or reuse of an old turn token.
 */
export function inspectBrokerCallJournal(directory: string): BrokerRecoveryCall[] {
  if (!existsSync(directory)) return [];
  if (!lstatSync(directory).isDirectory()) invalid();

  const calls = new Map<string, { traceId: string; tool: string; events: Set<BrokerCallEvent> }>();
  let recordCount = 0;
  let traceCount = 0;
  let pendingCount = 0;
  for (const folder of readdirSync(directory, { withFileTypes: true })) {
    if (++traceCount > MAX_TRACES) invalid();
    if (!/^[0-9a-f]{12}$/.test(folder.name) || !folder.isDirectory() || folder.isSymbolicLink()) invalid();
    const folderPath = join(directory, folder.name);
    for (const file of readdirSync(folderPath, { withFileTypes: true })) {
      // A crash before atomic publication leaves an uncommitted temporary record.
      if (/^\.[0-9a-f]{64}\.[0-9a-f]{24}\.pending$/.test(file.name)) {
        if (++pendingCount > MAX_PENDING_FILES || !file.isFile() || file.isSymbolicLink()) invalid();
        continue;
      }
      if (!/^[0-9a-f]{64}\.json$/.test(file.name) || !file.isFile() || file.isSymbolicLink()) invalid();
      if (++recordCount > MAX_RECORDS) invalid();
      const path = join(folderPath, file.name);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size < 2 || stat.size > MAX_RECORD_BYTES) invalid();
      let entry: BrokerCallEvidence;
      try { entry = JSON.parse(readFileSync(path, "utf8")) as BrokerCallEvidence; }
      catch { invalid(); }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || Object.keys(entry).sort().join(",") !== ["callId", "event", "recordedAt", "replayAuthorized", "resultRecoverable", "tool", "traceId", "version"].sort().join(",")
        || entry.version !== 1 || entry.traceId !== folder.name
        || typeof entry.callId !== "string" || !/^call_[A-Za-z0-9_-]{32}$/.test(entry.callId)
        || typeof entry.tool !== "string" || !/^[A-Za-z0-9_.:-]{1,256}$/.test(entry.tool)
        || !EVENTS.has(entry.event) || typeof entry.recordedAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.recordedAt)
        || Number.isNaN(Date.parse(entry.recordedAt))
        || new Date(entry.recordedAt).toISOString() !== entry.recordedAt
        || entry.replayAuthorized !== false || entry.resultRecoverable !== false
        || `${createHash("sha256").update(`v1:${entry.callId}:${entry.event}`).digest("hex")}.json` !== file.name) invalid();
      const prior = calls.get(entry.callId);
      if (prior && (prior.traceId !== entry.traceId || prior.tool !== entry.tool || prior.events.has(entry.event))) invalid();
      if (prior) prior.events.add(entry.event);
      else calls.set(entry.callId, { traceId: entry.traceId, tool: entry.tool, events: new Set([entry.event]) });
    }
  }

  return [...calls].map(([callId, { traceId, tool, events }]) => {
    if (!events.has("queued")
      || (events.has("result_received") && !events.has("delivery_possible"))
      || (events.has("compaction_resolution_possible") && events.has("delivery_possible"))
      || (events.has("result_received") && events.has("retired_uncertain"))) invalid();
    const state: BrokerRecoveryState = events.has("result_received") ? "result_unavailable"
      : events.has("retired_uncertain") ? "retired_uncertain"
      : events.has("delivery_possible") ? "delivery_unknown"
      : events.has("compaction_resolution_possible") ? "compaction_resolution_unavailable"
      : "queued_unconfirmed";
    return { traceId, callId, tool, state, resultRecoverable: false as const, replayAuthorized: false as const };
  }).sort((a, b) => a.traceId.localeCompare(b.traceId) || a.callId.localeCompare(b.callId));
}
