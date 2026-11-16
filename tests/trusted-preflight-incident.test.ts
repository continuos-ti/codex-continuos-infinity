import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MissingTrustedCodexEnvironmentError } from "../src/adapters/chatgpt-web/environment";
import { classifyTrustedPreflightFailure, recordTrustedPreflightIncident } from "../src/adapters/chatgpt-web/trusted-preflight-incident";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const threadId = "01a06c66-a0af-7769-b04e-976542277181";
const turnId = "01a06c66-37dc-7c86-85f9-a92e0bb6b638";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "codex-preflight-incident-"));
  roots.push(root);
  return { directory: join(root, "diagnostics", "preflight-incidents"), traceId: "112233aabbcc",
    identity: { threadId, turnId } };
}

describe("durable trusted preflight incident", () => {
  test("records native IDs, phase and no tool execution before an unsent turn", () => {
    const args = fixture();
    const result = recordTrustedPreflightIncident({ ...args, error: new MissingTrustedCodexEnvironmentError("cwd"),
      now: new Date("2026-11-10T18:00:00.000Z") });
    expect(result).toMatchObject({ recorded: true, classification: "missing_cwd_authority" });
    const record = JSON.parse(readFileSync(result!.path, "utf8"));
    expect(record).toEqual({
      version: 1, traceId: args.traceId, createdAt: "2026-11-10T18:00:00.000Z",
      phase: "before_submission", classification: "missing_cwd_authority",
      threadId, turnId, thisAttemptSubmitted: false, priorSubmissionState: "unknown", currentAttemptToolDispatches: 0,
      checkpoint: "preflight_blocked", recovery: "await_authoritative_native_environment", autoRepairAttempts: 0,
    });
    if (process.platform !== "win32") {
      expect(statSync(result!.path).mode & 0o777).toBe(0o600);
      expect(statSync(args.directory).mode & 0o777).toBe(0o700);
    }
  });

  test("same trace never overwrites accepted incident evidence", () => {
    const args = fixture();
    const original = recordTrustedPreflightIncident({ ...args, error: new MissingTrustedCodexEnvironmentError("cwd") });
    const first = readFileSync(original!.path, "utf8");
    const duplicate = recordTrustedPreflightIncident({ ...args, error: new Error("Codex rollout cwd is invalid"),
      now: new Date("2030-01-01T00:00:00.000Z") });
    expect(duplicate?.recorded).toBe(false);
    expect(readFileSync(original!.path, "utf8")).toBe(first);
    expect(readdirSync(args.directory)).toEqual([`${args.traceId}.json`]);
  });

  test("does not persist secrets, arbitrary errors, invalid identifiers or paths", () => {
    const args = fixture();
    const unexpected = new Error("private-data: sk-EXAMPLE_SECRET workspace D:/private/project");
    expect(classifyTrustedPreflightFailure(unexpected)).toBeUndefined();
    expect(recordTrustedPreflightIncident({ ...args, error: unexpected })).toBeUndefined();
    const result = recordTrustedPreflightIncident({ ...args,
      identity: { threadId: "my-private-thread", turnId: "turn_fake", promptCacheKey: "secret-sentinel" },
      error: new MissingTrustedCodexEnvironmentError("existing cwd") });
    const raw = readFileSync(result!.path, "utf8");
    expect(raw).not.toContain("private");
    expect(raw).not.toContain("sentinel");
    expect(raw).not.toContain("turn_fake");
    expect(raw).not.toContain("workspace");
    expect(JSON.parse(raw).threadId).toBeUndefined();
    expect(JSON.parse(raw).turnId).toBeUndefined();
  });

  test("classifies native proof failures and denies unknown or forged trace IDs", () => {
    expect(classifyTrustedPreflightFailure(new Error("Codex rollout cwd no longer exists as an accessible directory")))
      .toBe("removed_or_invalid_cwd");
    expect(classifyTrustedPreflightFailure(new MissingTrustedCodexEnvironmentError("existing cwd")))
      .toBe("removed_or_invalid_cwd");
    expect(classifyTrustedPreflightFailure(new MissingTrustedCodexEnvironmentError("network access")))
      .toBe("missing_permission_authority");
    expect(classifyTrustedPreflightFailure(new Error("Codex thread exists in multiple trusted homes")))
      .toBe("ambiguous_native_owner");
    const args = fixture();
    expect(() => recordTrustedPreflightIncident({ ...args, traceId: "../../elsewhere",
      error: new MissingTrustedCodexEnvironmentError("cwd") })).toThrow("Invalid trusted preflight trace id");
    expect(readdirSync(join(args.directory, "..", "..")).length).toBe(0);
  });
});
