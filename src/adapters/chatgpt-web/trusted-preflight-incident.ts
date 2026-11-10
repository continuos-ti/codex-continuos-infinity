import { closeSync, fsyncSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isNativeCodexIdentifier } from "./codex-rollout-environment";
import { MissingTrustedCodexEnvironmentError, type ChatGptTurnIdentity } from "./environment";

export type TrustedPreflightFailure =
  | "missing_cwd_authority"
  | "missing_permission_authority"
  | "removed_or_invalid_cwd"
  | "native_rollout_unavailable"
  | "ambiguous_native_owner";

/** Classify only proven pre-send trusted-environment errors. Do not persist arbitrary error text. */
export function classifyTrustedPreflightFailure(error: unknown): TrustedPreflightFailure | undefined {
  if (error instanceof MissingTrustedCodexEnvironmentError) {
    if (error.field === "cwd" || error.field === "existing cwd"
      || error.field === "current native worktree authority") return "missing_cwd_authority";
    if (error.field === "network access" || error.field === "current native task ownership") {
      return "missing_permission_authority";
    }
    return undefined;
  }
  if (!(error instanceof Error)) return undefined;
  if (error.message === "Codex rollout cwd no longer exists as an accessible directory"
    || error.message === "Codex rollout cwd is invalid"
    || error.message === "Codex rollout cwd is outside its workspace roots") return "removed_or_invalid_cwd";
  if (error.message === "Codex has no canonical rollout for the requested current turn"
    || error.message === "Codex has no canonical rollout for the requested subagent thread"
    || error.message === "Latest Codex rollout turn context does not belong to the requested turn"
    || error.message === "No current native Codex task proof in the trusted homes") {
    return "native_rollout_unavailable";
  }
  if (error.message === "Codex thread exists in multiple trusted homes"
    || error.message === "Codex has multiple canonical rollouts for the requested current turn") {
    return "ambiguous_native_owner";
  }
  return undefined;
}

export interface TrustedPreflightIncident {
  version: 1;
  traceId: string;
  createdAt: string;
  phase: "before_submission";
  classification: TrustedPreflightFailure;
  threadId?: string;
  turnId?: string;
  thisAttemptSubmitted: false;
  priorSubmissionState: "unknown";
  currentAttemptToolDispatches: 0;
  checkpoint: "preflight_blocked";
  recovery: "await_authoritative_native_environment";
  autoRepairAttempts: 0;
}

/** Durable, first-writer-wins evidence. Never stores the request, paths, secrets or turn tokens. */
export function recordTrustedPreflightIncident(input: {
  directory: string;
  traceId: string;
  identity: ChatGptTurnIdentity;
  error: unknown;
  now?: Date;
}): { path: string; recorded: boolean; classification: TrustedPreflightFailure } | undefined {
  const classification = classifyTrustedPreflightFailure(input.error);
  if (!classification) return undefined;
  if (!/^[0-9a-f]{12}$/.test(input.traceId)) throw new Error("Invalid trusted preflight trace id");
  const incident: TrustedPreflightIncident = {
    version: 1,
    traceId: input.traceId,
    createdAt: (input.now ?? new Date()).toISOString(),
    phase: "before_submission",
    classification,
    ...(isNativeCodexIdentifier(input.identity.threadId) ? { threadId: input.identity.threadId } : {}),
    ...(isNativeCodexIdentifier(input.identity.turnId) ? { turnId: input.identity.turnId } : {}),
    thisAttemptSubmitted: false,
    priorSubmissionState: "unknown",
    currentAttemptToolDispatches: 0,
    checkpoint: "preflight_blocked",
    recovery: "await_authoritative_native_environment",
    autoRepairAttempts: 0,
  };
  mkdirSync(input.directory, { recursive: true, mode: 0o700 });
  const path = join(input.directory, `${input.traceId}.json`);
  let fd: number;
  try { fd = openSync(path, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { path, recorded: false, classification };
    throw error;
  }
  let durable = false;
  try {
    writeFileSync(fd, JSON.stringify(incident) + "\n");
    fsyncSync(fd);
    durable = true;
  } finally {
    closeSync(fd);
    // Do not leave a partial JSON record if the storage write failed.
    if (!durable) rmSync(path, { force: true });
  }
  return { path, recorded: true, classification };
}