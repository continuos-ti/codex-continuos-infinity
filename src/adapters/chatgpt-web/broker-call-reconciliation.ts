import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { BrokerCallEvent, BrokerCallEvidence } from "./broker-call-journal";
import { resolveCurrentCodexRolloutEnvironment } from "./codex-rollout-environment";
import type { ChatGptRootThreadMetadata, ChatGptThreadSpawnLineage } from "./environment";
import { nativeBrokerOwnerDigest } from "./native-broker-owner";
import { BrokerResultVault, captureBrokerResultFileEvidence, vaultDirectoryForJournal,
  type ResultIdentity } from "./sealed-broker-results";
import type { BrokerToolResult } from "./turn-broker";

const EVENTS = new Set<BrokerCallEvent>([
  "queued", "delivery_possible", "result_received", "compaction_resolution_possible", "retired_uncertain",
]);
const MAX_RECORDS = 20_000;
const MAX_RECORD_BYTES = 4_096;
const MAX_TRACES = 20_000;
const MAX_PENDING_FILES = 20_000;
const MAX_AUTHENTICATED_SNAPSHOT_CALLS = 64;
const MAX_AUTHENTICATED_SNAPSHOT_RESULT_BYTES = 64 * 1024 * 1024;

export type BrokerRecoveryState = "queued_unconfirmed" | "delivery_unknown"
  | "result_unavailable" | "compaction_resolution_unavailable" | "retired_uncertain";

export interface BrokerRecoveryCall {
  traceId: string;
  callId: string;
  tool: string;
  nativeOwnerDigest?: string;
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
 * result. An adjacent encrypted vault may retain the body, but this journal reader neither
 * authenticates the current native owner nor decrypts results or infers effects from them.
 * No state returned here licenses re-execution, continuation or reuse of an old turn token.
 */
function inspectBrokerCallJournalSnapshot(directory: string): {
  calls: BrokerRecoveryCall[];
  fingerprint: string;
  pendingPublication: boolean;
} {
  if (!existsSync(directory)) return { calls: [], fingerprint: "", pendingPublication: false };
  if (!lstatSync(directory).isDirectory()) invalid();

  const calls = new Map<string, { traceId: string; tool: string; nativeOwnerDigest?: string; events: Set<BrokerCallEvent> }>();
  const fingerprint = createHash("sha256");
  let recordCount = 0;
  let traceCount = 0;
  let pendingCount = 0;
  for (const folder of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (++traceCount > MAX_TRACES) invalid();
    if (!/^[0-9a-f]{12}$/.test(folder.name) || !folder.isDirectory() || folder.isSymbolicLink()) invalid();
    const folderPath = join(directory, folder.name);
    fingerprint.update(folder.name).update("\0");
    for (const file of readdirSync(folderPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      // A crash before atomic publication leaves an uncommitted temporary record.
      if (/^\.[0-9a-f]{64}\.[0-9a-f]{24}\.pending$/.test(file.name)) {
        if (++pendingCount > MAX_PENDING_FILES || !file.isFile() || file.isSymbolicLink()) invalid();
        fingerprint.update(file.name).update("\0");
        continue;
      }
      if (!/^[0-9a-f]{64}\.json$/.test(file.name) || !file.isFile() || file.isSymbolicLink()) invalid();
      if (++recordCount > MAX_RECORDS) invalid();
      const path = join(folderPath, file.name);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size < 2 || stat.size > MAX_RECORD_BYTES) invalid();
      const raw = readFileSync(path);
      if (raw.byteLength !== stat.size) invalid();
      fingerprint.update(file.name).update("\0").update(raw).update("\0");
      let entry: BrokerCallEvidence;
      try { entry = JSON.parse(raw.toString("utf8")) as BrokerCallEvidence; }
      catch { invalid(); }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || Object.keys(entry).sort().join(",") !== ["callId", "event", "recordedAt", "replayAuthorized", "resultRecoverable", "tool", "traceId", "version", ...(entry.nativeOwnerDigest === undefined ? [] : ["nativeOwnerDigest"])].sort().join(",")
        || entry.version !== 1 || entry.traceId !== folder.name
        || typeof entry.callId !== "string" || !/^call_[A-Za-z0-9_-]{32}$/.test(entry.callId)
        || typeof entry.tool !== "string" || !/^[A-Za-z0-9_.:-]{1,256}$/.test(entry.tool)
        || (entry.nativeOwnerDigest !== undefined && (typeof entry.nativeOwnerDigest !== "string" || !/^[0-9a-f]{64}$/.test(entry.nativeOwnerDigest)))
        || !EVENTS.has(entry.event) || typeof entry.recordedAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.recordedAt)
        || Number.isNaN(Date.parse(entry.recordedAt))
        || new Date(entry.recordedAt).toISOString() !== entry.recordedAt
        || entry.replayAuthorized !== false || entry.resultRecoverable !== false
        || `${createHash("sha256").update(`v1:${entry.callId}:${entry.event}`).digest("hex")}.json` !== file.name) invalid();
      const prior = calls.get(entry.callId);
      if (prior && (prior.traceId !== entry.traceId || prior.tool !== entry.tool
        || prior.nativeOwnerDigest !== entry.nativeOwnerDigest || prior.events.has(entry.event))) invalid();
      if (prior) prior.events.add(entry.event);
      else calls.set(entry.callId, { traceId: entry.traceId, tool: entry.tool,
        ...(entry.nativeOwnerDigest ? { nativeOwnerDigest: entry.nativeOwnerDigest } : {}), events: new Set([entry.event]) });
    }
  }

  const observed = [...calls].map(([callId, { traceId, tool, nativeOwnerDigest, events }]) => {
    if (!events.has("queued")
      || (events.has("result_received") && !events.has("delivery_possible"))
      || (events.has("compaction_resolution_possible") && events.has("delivery_possible"))
      || (events.has("result_received") && events.has("retired_uncertain"))) invalid();
    const state: BrokerRecoveryState = events.has("result_received") ? "result_unavailable"
      : events.has("retired_uncertain") ? "retired_uncertain"
      : events.has("delivery_possible") ? "delivery_unknown"
      : events.has("compaction_resolution_possible") ? "compaction_resolution_unavailable"
      : "queued_unconfirmed";
    return { traceId, callId, tool, ...(nativeOwnerDigest ? { nativeOwnerDigest } : {}), state,
      resultRecoverable: false as const, replayAuthorized: false as const };
  }).sort((a, b) => a.traceId.localeCompare(b.traceId) || a.callId.localeCompare(b.callId));
  return { calls: observed, fingerprint: fingerprint.digest("hex"), pendingPublication: pendingCount > 0 };
}

export function inspectBrokerCallJournal(directory: string): BrokerRecoveryCall[] {
  return inspectBrokerCallJournalSnapshot(directory).calls;
}

export type AuthenticatedBrokerResultEvidence = {
  status: "unavailable";
  /** An unavailable result is never a reason to dispatch the call again. */
  replayAuthorized: false;
  externalEffectsReconciled: false;
} | {
  status: "verified_result_evidence";
  /** A result returned by the previous broker, authenticated against current Codex ownership. */
  result: BrokerToolResult;
  replayAuthorized: false;
  externalEffectsReconciled: false;
};

export type AuthenticatedBrokerCallInventory = {
  status: "unavailable";
  replayAuthorized: false;
  externalEffectsReconciled: false;
} | {
  status: "verified_native_call_inventory";
  /** Calls owned by this native turn across all diagnostic traces, including changed providers. */
  calls: BrokerRecoveryCall[];
  replayAuthorized: false;
  externalEffectsReconciled: false;
};

/**
 * Inventory a crashed broker's call boundaries using current native Codex authority. Diagnostic
 * traces can change across restarts, so discover calls by authenticated owner digest. This only
 * returns the journal's observation states. Sealed bodies require an explicit authenticated
 * read per call, and neither operation reconciles effects or enables tool dispatch.
 */
export function readAuthenticatedBrokerCallInventory(input: {
  journalDirectory: string;
  codexHome: string;
  additionalCodexHomes?: readonly string[];
  sqliteHome?: string;
  lineage: ChatGptRootThreadMetadata | ChatGptThreadSpawnLineage;
  turnId: string;
}): AuthenticatedBrokerCallInventory {
  const unavailable = (): AuthenticatedBrokerCallInventory => ({
    status: "unavailable", replayAuthorized: false, externalEffectsReconciled: false,
  });
  const ownerDigest = nativeBrokerOwnerDigest({ threadId: input.lineage.threadId, turnId: input.turnId });
  // An absent journal directory provides no evidence that a previous broker was empty.
  if (!ownerDigest || !existsSync(input.journalDirectory)) return unavailable();

  const ownerOptions = {
    codexHome: input.codexHome,
    ...(input.additionalCodexHomes ? { additionalCodexHomes: input.additionalCodexHomes } : {}),
    ...(input.sqliteHome ? { sqliteHome: input.sqliteHome } : {}),
    lineage: input.lineage,
    turnId: input.turnId,
  };
  let initialOwner: ReturnType<typeof resolveCurrentCodexRolloutEnvironment>;
  try {
    initialOwner = resolveCurrentCodexRolloutEnvironment(ownerOptions);
    if (!initialOwner) return unavailable();
  } catch {
    return unavailable();
  }

  // Journal corruption is a recovery error, including corruption in another trace. Do not
  // silently turn it into an empty inventory that might be mistaken for a clean turn.
  const before = inspectBrokerCallJournalSnapshot(input.journalDirectory);
  if (before.pendingPublication) return unavailable();
  const observedCalls = before.calls;
  // Legacy calls lack a native owner digest and might belong to this turn. Their identity
  // cannot be ruled out, even when other records are attributed to the current owner.
  if (observedCalls.some(call => !call.nativeOwnerDigest)) return unavailable();
  const calls = observedCalls.filter(call => call.nativeOwnerDigest === ownerDigest);
  try {
    const currentOwner = resolveCurrentCodexRolloutEnvironment(ownerOptions);
    if (!currentOwner || !isDeepStrictEqual(currentOwner, initialOwner)) return unavailable();
  } catch {
    return unavailable();
  }
  const after = inspectBrokerCallJournalSnapshot(input.journalDirectory);
  if (after.pendingPublication || after.fingerprint !== before.fingerprint
    || !isDeepStrictEqual(after.calls, before.calls)) {
    return unavailable();
  }
  return {
    status: "verified_native_call_inventory", calls,
    replayAuthorized: false, externalEffectsReconciled: false,
  };
}

/**
 * Recover the body only for a freshly authenticated native Codex turn. This internal API accepts
 * native lineage and registered Codex homes supplied by the trusted runtime. It does not accept
 * a client-supplied owner digest, a historical turn token, or an arbitrary compaction ancestor.
 * A matching journal boundary proves reception of a result, not its external side effects.
 * Callers must still reconcile external effects before deciding how to resume a task.
 */
export function readAuthenticatedBrokerResultEvidence(input: {
  journalDirectory: string;
  codexHome: string;
  additionalCodexHomes?: readonly string[];
  sqliteHome?: string;
  lineage: ChatGptRootThreadMetadata | ChatGptThreadSpawnLineage;
  turnId: string;
  traceId: string;
  callId: string;
}): AuthenticatedBrokerResultEvidence {
  const unavailable = (): AuthenticatedBrokerResultEvidence => ({
    status: "unavailable", replayAuthorized: false, externalEffectsReconciled: false,
  });
  const ownerDigest = nativeBrokerOwnerDigest({ threadId: input.lineage.threadId, turnId: input.turnId });
  if (!ownerDigest) return unavailable();

  const ownerOptions = {
    codexHome: input.codexHome,
    ...(input.additionalCodexHomes ? { additionalCodexHomes: input.additionalCodexHomes } : {}),
    ...(input.sqliteHome ? { sqliteHome: input.sqliteHome } : {}),
    lineage: input.lineage,
    turnId: input.turnId,
  };
  // Codex's canonical rollout and current turn_context are independent of the old broker.
  // An absent, ambiguous, stale or invalid native owner cannot authorize reading a body.
  let initialOwner: ReturnType<typeof resolveCurrentCodexRolloutEnvironment>;
  try {
    initialOwner = resolveCurrentCodexRolloutEnvironment(ownerOptions);
    if (!initialOwner) return unavailable();
  } catch {
    return unavailable();
  }

  const before = inspectBrokerCallJournalSnapshot(input.journalDirectory);
  if (before.pendingPublication) return unavailable();
  const call = before.calls.find(entry =>
    entry.traceId === input.traceId && entry.callId === input.callId);
  if (!call || call.state !== "result_unavailable" || call.nativeOwnerDigest !== ownerDigest) {
    return unavailable();
  }
  const vaultDirectory = vaultDirectoryForJournal(input.journalDirectory);
  const identity: ResultIdentity = {
    traceId: call.traceId, callId: call.callId, tool: call.tool, nativeOwnerDigest: ownerDigest,
  };
  const beforeVault = captureBrokerResultFileEvidence(vaultDirectory, [identity]);
  const result = new BrokerResultVault(vaultDirectory).read(identity);
  if (!result) return unavailable();

  // A concurrent broker publication or rewrite invalidates this evidence even when the
  // authenticated native owner and the recovered ciphertext remain unchanged.
  const after = inspectBrokerCallJournalSnapshot(input.journalDirectory);
  if (after.pendingPublication || after.fingerprint !== before.fingerprint
    || !isDeepStrictEqual(after.calls, before.calls)) {
    return unavailable();
  }
  const afterVault = captureBrokerResultFileEvidence(vaultDirectory, [identity]);
  if (beforeVault.pendingPublication || afterVault.pendingPublication
    || beforeVault.fingerprint !== afterVault.fingerprint) return unavailable();

  // The owner could have moved to another native turn while the journal/vault were read.
  try {
    const currentOwner = resolveCurrentCodexRolloutEnvironment(ownerOptions);
    if (!currentOwner || !isDeepStrictEqual(currentOwner, initialOwner)) return unavailable();
  } catch {
    return unavailable();
  }
  return {
    status: "verified_result_evidence", result,
    replayAuthorized: false, externalEffectsReconciled: false,
  };
}

export type AuthenticatedBrokerRecoverySnapshot = {
  status: "unavailable";
  replayAuthorized: false;
  externalEffectsReconciled: false;
} | {
  status: "verified_native_recovery_snapshot";
  /** Complete bounded inventory for the current native owner, with individually sealed results. */
  calls: Array<{ call: BrokerRecoveryCall; resultEvidence: AuthenticatedBrokerResultEvidence }>;
  replayAuthorized: false;
  externalEffectsReconciled: false;
};

/**
 * Collect one bounded, authenticated observation of a stopped broker across traces.
 * Verify native ownership before and after vault reads and reject any concurrent journal
 * publication. Results are evidence only. In particular, this API cannot authorize a new
 * Codex turn binding, infer external effects or re-dispatch a mutating tool.
 */
export function readAuthenticatedBrokerRecoverySnapshot(input: {
  journalDirectory: string;
  codexHome: string;
  additionalCodexHomes?: readonly string[];
  sqliteHome?: string;
  lineage: ChatGptRootThreadMetadata | ChatGptThreadSpawnLineage;
  turnId: string;
}): AuthenticatedBrokerRecoverySnapshot {
  const unavailable = (): AuthenticatedBrokerRecoverySnapshot => ({
    status: "unavailable", replayAuthorized: false, externalEffectsReconciled: false,
  });
  const ownerDigest = nativeBrokerOwnerDigest({ threadId: input.lineage.threadId, turnId: input.turnId });
  if (!ownerDigest || !existsSync(input.journalDirectory)) return unavailable();

  const ownerOptions = {
    codexHome: input.codexHome,
    ...(input.additionalCodexHomes ? { additionalCodexHomes: input.additionalCodexHomes } : {}),
    ...(input.sqliteHome ? { sqliteHome: input.sqliteHome } : {}),
    lineage: input.lineage,
    turnId: input.turnId,
  };
  let initialOwner: ReturnType<typeof resolveCurrentCodexRolloutEnvironment>;
  try {
    initialOwner = resolveCurrentCodexRolloutEnvironment(ownerOptions);
    if (!initialOwner) return unavailable();
  } catch {
    return unavailable();
  }

  const before = inspectBrokerCallJournalSnapshot(input.journalDirectory);
  if (before.pendingPublication) return unavailable();
  if (before.calls.some(call => !call.nativeOwnerDigest)) return unavailable();
  const owned = before.calls.filter(call => call.nativeOwnerDigest === ownerDigest);
  if (owned.length > MAX_AUTHENTICATED_SNAPSHOT_CALLS) {
    throw new Error("Broker recovery snapshot exceeds the bounded call count");
  }
  const vaultDirectory = vaultDirectoryForJournal(input.journalDirectory);
  const vault = new BrokerResultVault(vaultDirectory);
  const resultIdentities: ResultIdentity[] = owned.map(call => ({
    traceId: call.traceId, callId: call.callId, tool: call.tool, nativeOwnerDigest: ownerDigest,
  }));
  const beforeVault = captureBrokerResultFileEvidence(vaultDirectory, resultIdentities);
  let totalResultBytes = 0;
  const calls = owned.map(call => {
    let resultEvidence: AuthenticatedBrokerResultEvidence = {
      status: "unavailable", replayAuthorized: false, externalEffectsReconciled: false,
    };
    if (call.state === "result_unavailable") {
      const result = vault.read({
        traceId: call.traceId, callId: call.callId, tool: call.tool, nativeOwnerDigest: ownerDigest,
      });
      if (result) {
        totalResultBytes += Buffer.byteLength(JSON.stringify(result));
        if (totalResultBytes > MAX_AUTHENTICATED_SNAPSHOT_RESULT_BYTES) {
          throw new Error("Broker recovery snapshot exceeds the bounded result size");
        }
        resultEvidence = {
          status: "verified_result_evidence", result,
          replayAuthorized: false, externalEffectsReconciled: false,
        };
      }
    }
    return { call, resultEvidence };
  });

  // Fingerprint covers every record's bytes and every pending filename, so modifications
  // that leave the logical states unchanged still invalidate the collected evidence.
  const after = inspectBrokerCallJournalSnapshot(input.journalDirectory);
  if (after.pendingPublication || after.fingerprint !== before.fingerprint
    || !isDeepStrictEqual(after.calls, before.calls)) {
    return unavailable();
  }
  const afterVault = captureBrokerResultFileEvidence(vaultDirectory, resultIdentities);
  if (beforeVault.pendingPublication || afterVault.pendingPublication
    || beforeVault.fingerprint !== afterVault.fingerprint) return unavailable();
  try {
    const currentOwner = resolveCurrentCodexRolloutEnvironment(ownerOptions);
    if (!currentOwner || !isDeepStrictEqual(currentOwner, initialOwner)) return unavailable();
  } catch {
    return unavailable();
  }
  return {
    status: "verified_native_recovery_snapshot", calls,
    replayAuthorized: false, externalEffectsReconciled: false,
  };
}
