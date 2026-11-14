import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const MAX_FILES = 128;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const CHECKPOINT_FILE = /^\d{2,3}-([a-z0-9-]+)\.json$/;

type Row = Record<string, unknown>;
function object(value: unknown): Row | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Forensic projection of private browser snapshots. No prompt, rendered text, HTML,
 * URLs, auth material, tool payloads or call identifiers leave this function.
 * A missing completion control is not evidence that a tool did not run.
 */
export function inspectBrowserTurnDiagnostics(directory: string) {
  const root = lstatSync(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Expected a real trace directory");
  const files = readdirSync(directory, { withFileTypes: true })
    .filter(entry => CHECKPOINT_FILE.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (files.length > MAX_FILES) throw new Error("Too many browser diagnostic checkpoints");
  const stages: string[] = [];
  let totalBytes = 0;
  let last: Row | undefined;
  for (const file of files) {
    if (!file.isFile() || file.isSymbolicLink()) throw new Error("Unsafe browser diagnostic checkpoint");
    const path = join(directory, file.name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) {
      throw new Error("Unsafe browser diagnostic checkpoint");
    }
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Browser diagnostics exceed read budget");
    const parsed = object(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed || typeof parsed.checkpoint !== "string"
      || parsed.checkpoint !== CHECKPOINT_FILE.exec(file.name)?.[1]) {
      throw new Error("Invalid browser diagnostic checkpoint");
    }
    stages.push(parsed.checkpoint);
    last = parsed;
  }
  const turns = object(last?.state)?.turns;
  const turn = object(Array.isArray(turns) ? turns.at(-1) : turns);
  const assistant = object(list(turn?.assistant).at(-1));
  const traceId = typeof last?.traceId === "string" && /^[0-9a-f]{12}$/.test(last.traceId)
    ? last.traceId : null;
  const sendAccepted = stages.includes("send-accepted");
  const failed = stages.includes("turn-failed");
  const completed = stages.includes("turn-completed");
  return {
    traceId,
    directoryName: /^[0-9a-f]{12}-[0-9a-f]{8}$/.test(basename(directory)) ? basename(directory) : null,
    checkpointCount: stages.length,
    lastCheckpoint: stages.at(-1) ?? null,
    lastCapturedAt: typeof last?.capturedAt === "string"
      && !Number.isNaN(Date.parse(last.capturedAt)) ? last.capturedAt : null,
    sendAccepted,
    state: failed ? "failed_without_proven_final" : completed
      ? "completed_checkpoint_requires_native_confirmation" : "not_terminally_confirmed",
    observed: {
      stopButtons: count(turn?.stopButtonCount),
      assistantTextChars: count(assistant?.textChars),
      markdownNodes: count(assistant?.markdownCount),
      completionControls: count(assistant?.completionActionCount),
      renderedCompletionControls: count(assistant?.renderedCompletionActionCount),
    },
    externalToolEffects: "unknown",
    replayAuthorized: false,
    nativeCompletionConfirmed: false,
  } as const;
}

if (import.meta.main) {
  if (process.argv.length !== 3) throw new Error("Usage: bun scripts/inspect-browser-turn.ts <trace-directory>");
  process.stdout.write(JSON.stringify(inspectBrowserTurnDiagnostics(process.argv[2]!)) + "\n");
}
