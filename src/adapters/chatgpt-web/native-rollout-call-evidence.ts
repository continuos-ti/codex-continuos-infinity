import { closeSync, fstatSync, openSync, readSync } from "node:fs";

const MAX_ROLLOUT_BYTES = 128 * 1024 * 1024;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const CALL_ID = /^call_[A-Za-z0-9_-]{32}$/;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,256}$/;

export interface NativeCallIdentity {
  callId: string;
  tool: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Read the same bounded file descriptor twice to reject concurrent appends and rewrites. */
function stableRolloutBytes(path: string): Buffer | undefined {
  const fd = openSync(path, "r");
  try {
    const before = fstatSync(fd);
    if (before.size <= 0 || before.size > MAX_ROLLOUT_BYTES) return undefined;
    const read = (): Buffer | undefined => {
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (count <= 0) return undefined;
        offset += count;
      }
      return bytes;
    };
    const first = read();
    const second = read();
    const after = fstatSync(fd);
    if (!first || !second || !first.equals(second) || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) return undefined;
    return first;
  } finally {
    closeSync(fd);
  }
}

/**
 * Observe only matching native invocation/output pairs within the requested task boundary.
 * The rollout path must already have been authenticated against native thread/turn authority.
 * No output bodies leave this reader. A recorded output cannot prove external side effects,
 * authorize a replay, or create a new tool capability after a broker crash.
 */
export function observeNativeCallOutputs(
  rolloutPath: string,
  turnId: string,
  identities: readonly NativeCallIdentity[],
): ReadonlySet<string> {
  const unavailable = (): ReadonlySet<string> => new Set();
  if (new Set(identities.map(identity => identity.callId)).size !== identities.length
    || identities.some(identity => !CALL_ID.test(identity.callId) || !TOOL_NAME.test(identity.tool))) {
    return unavailable();
  }
  if (identities.length === 0) return unavailable();

  try {
    const bytes = stableRolloutBytes(rolloutPath);
    if (!bytes || bytes[bytes.length - 1] !== 0x0a) return unavailable();

    const requested = new Map(identities.map(identity => [identity.callId, identity.tool]));
    const calls = new Map<string, { expectedOutput: string; outputSeen: boolean }>();
    let active = false;
    let started = false;
    const otherActiveTurns = new Set<string>();
    for (let start = 0; start < bytes.length;) {
      const end = bytes.indexOf(0x0a, start);
      if (end < 0 || end - start > MAX_RECORD_BYTES) return unavailable();
      const line = bytes.subarray(start, end);
      start = end + 1;
      if (line.length === 0) continue;
      const item = record(JSON.parse(line.toString("utf8").replace(/^\uFEFF/, "")));
      if (!item) return unavailable();
      const payload = record(item.payload);

      if (item.type === "event_msg" && payload?.type === "task_started") {
        if (payload.turn_id === turnId && started) return unavailable();
        if (payload.turn_id === turnId) {
          active = true;
          started = true;
        } else if (typeof payload.turn_id === "string") {
          // A repeated foreign start loses the correct overlap count if treated as a set.
          if (otherActiveTurns.has(payload.turn_id)) return unavailable();
          otherActiveTurns.add(payload.turn_id);
        } else {
          // An unidentified turn may overlap later target records.
          return unavailable();
        }
        continue;
      }
      if (item.type === "event_msg" && payload?.type === "task_complete") {
        if (payload.turn_id === turnId) {
          active = false;
        } else if (typeof payload.turn_id === "string") {
          // An unpaired foreign completion can hide an unknown concurrent owner.
          if (!otherActiveTurns.delete(payload.turn_id) && active) return unavailable();
        } else if (payload.turn_id === undefined && active && otherActiveTurns.size === 0) {
          // Older rollouts omit the completion ID. Keep their single-turn evidence.
          active = false;
        } else if (active) {
          return unavailable();
        }
        continue;
      }
      if (!active) continue;
      if (item.type === "compacted") return unavailable();
      if (item.type !== "response_item" || typeof payload?.call_id !== "string"
        || !requested.has(payload.call_id)) continue;

      // Native rollouts can interleave root and subagent turns. Explicit tool metadata
      // binds the record to its turn. Legacy records are ambiguous during overlap.
      const metadata = payload.internal_chat_message_metadata_passthrough;
      const metadataRecord = record(metadata);
      // A present but malformed native owner is not a legacy item without metadata.
      // Treating it as absent would attribute an ambiguous result to the only active turn.
      if (metadata !== undefined && (typeof metadataRecord?.turn_id !== "string"
        || metadataRecord.turn_id.length === 0)) return unavailable();
      const metadataTurnId = metadataRecord?.turn_id;
      if (metadataTurnId !== undefined && metadataTurnId !== turnId) continue;
      if (metadataTurnId === undefined && otherActiveTurns.size > 0) return unavailable();

      const id = payload.call_id;
      if (payload.type === "function_call" || payload.type === "custom_tool_call") {
        // The broker's journal binds this ID to a wire tool. An unrelated native call
        // with a reused ID cannot authenticate an output for the journal's tool.
        if (calls.has(id) || payload.name !== requested.get(id)) return unavailable();
        calls.set(id, { expectedOutput: `${payload.type}_output`, outputSeen: false });
      } else if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
        const call = calls.get(id);
        if (!call || call.expectedOutput !== payload.type || call.outputSeen) return unavailable();
        call.outputSeen = true;
      }
    }

    if (!started) return unavailable();
    return new Set([...calls].filter(([, call]) => call.outputSeen).map(([id]) => id));
  } catch {
    // Locked, truncated or malformed evidence is unavailable, never permission to replay.
    return unavailable();
  }
}
