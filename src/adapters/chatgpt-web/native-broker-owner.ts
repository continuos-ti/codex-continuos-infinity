import { createHash } from "node:crypto";
import { isNativeCodexIdentifier } from "./codex-rollout-environment";

/** A correlation fingerprint. The current Codex rollout must be verified separately. */
export function nativeBrokerOwnerDigest(identity?: { threadId?: string; turnId?: string }): string | undefined {
  if (!isNativeCodexIdentifier(identity?.threadId) || !isNativeCodexIdentifier(identity?.turnId)) {
    return undefined;
  }
  return createHash("sha256")
    .update(JSON.stringify([identity.threadId.toLowerCase(), identity.turnId.toLowerCase()]))
    .digest("hex");
}
