import { setTimeout as delay } from "node:timers/promises";
import type { ChatGptTurnIdentity } from "./environment";
import { isNativeCodexIdentifier } from "./codex-rollout-environment";
import { classifyTrustedPreflightFailure } from "./trusted-preflight-incident";

const PREFLIGHT_RETRY_DELAYS_MS = [150, 300] as const;

/**
 * The native rollout may be published just after the bridge receives the turn. Before any
 * browser submission, allow a bounded reread of the SAME authoritative source. The resolver
 * must perform its complete owner, workspace and sandbox checks on every attempt.
 */
export async function resolveTrustedPreflightWithRecovery<T>(
  identity: ChatGptTurnIdentity,
  resolve: () => T,
  signal?: AbortSignal,
  wait: (ms: number, signal?: AbortSignal) => Promise<unknown> = (ms, abortSignal) =>
    delay(ms, undefined, { signal: abortSignal }),
): Promise<{ value: T; recoveryAttempts: number }> {
  const nativeOwner = isNativeCodexIdentifier(identity.threadId)
    && isNativeCodexIdentifier(identity.turnId);
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return { value: resolve(), recoveryAttempts: attempt };
    } catch (error) {
      const failure = classifyTrustedPreflightFailure(error);
      if (!nativeOwner || attempt >= PREFLIGHT_RETRY_DELAYS_MS.length
        || (failure !== "missing_cwd_authority" && failure !== "missing_permission_authority"
          && failure !== "native_rollout_unavailable")) {
        throw error;
      }
      await wait(PREFLIGHT_RETRY_DELAYS_MS[attempt]!, signal);
    }
  }
}
