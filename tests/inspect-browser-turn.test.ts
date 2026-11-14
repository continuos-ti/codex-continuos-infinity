import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectBrowserTurnDiagnostics } from "../scripts/inspect-browser-turn";

function fixture(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "infinity-browser-turn-"));
  try { run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function checkpoint(directory: string, index: number, stage: string, state: object = {}) {
  writeFileSync(join(directory, String(index).padStart(2, "0") + "-" + stage + ".json"),
    JSON.stringify({
      checkpoint: stage,
      traceId: "39ce1d7966b1",
      capturedAt: "2026-11-14T00:16:09.481Z",
      state,
      privatePrompt: "do not leak credentials or user content",
      credential: "secret-value",
    }));
}

test("accepted stalled turns are not mistaken for completed work or safe replay", () => fixture(dir => {
  checkpoint(dir, 1, "send-accepted", {
    turns: [{ stopButtonCount: 1, assistant: [{ textChars: 200, markdownCount: 2 }] }],
  });
  checkpoint(dir, 2, "response-visible", {
    turns: [{ stopButtonCount: 1, assistant: [{ textChars: 201, markdownCount: 3 }] }],
  });
  checkpoint(dir, 3, "turn-failed", {
    turns: { stopButtonCount: 0, assistant: [{ textChars: 1200, markdownCount: 46,
      completionActionCount: 1, renderedCompletionActionCount: 0 }] },
  });
  const result = inspectBrowserTurnDiagnostics(dir);
  expect(result.directoryName).toBeNull();
  expect(result.sendAccepted).toBe(true);
  expect(result.state).toBe("failed_without_proven_final");
  expect(result.replayAuthorized).toBe(false);
  expect(result.externalToolEffects).toBe("unknown");
  expect(result.nativeCompletionConfirmed).toBe(false);
  expect(result.observed).toEqual({
    stopButtons: 0, assistantTextChars: 1200, markdownNodes: 46,
    completionControls: 1, renderedCompletionControls: 0,
  });
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(JSON.stringify(result)).not.toContain("do not leak");
}));

test("incomplete snapshots do not invent completion or effects", () => fixture(dir => {
  checkpoint(dir, 1, "send-accepted");
  checkpoint(dir, 2, "response-visible");
  const result = inspectBrowserTurnDiagnostics(dir);
  expect(result.state).toBe("not_terminally_confirmed");
  expect(result.observed.stopButtons).toBeNull();
  expect(result.observed.renderedCompletionControls).toBeNull();
  expect(result.replayAuthorized).toBe(false);
}));

test("rejects mismatched checkpoint identity and too many checkpoints", () => fixture(dir => {
  checkpoint(dir, 1, "send-accepted");
  writeFileSync(join(dir, "02-turn-failed.json"), JSON.stringify({ checkpoint: "turn-completed" }));
  expect(() => inspectBrowserTurnDiagnostics(dir)).toThrow("Invalid browser diagnostic checkpoint");
  rmSync(join(dir, "02-turn-failed.json"));
  for (let index = 2; index <= 130; index++) checkpoint(dir, index, "response-visible");
  expect(() => inspectBrowserTurnDiagnostics(dir)).toThrow("Too many");
}));

test("refuses missing or fake trace directories", () => fixture(dir => {
  expect(() => inspectBrowserTurnDiagnostics(join(dir, "missing"))).toThrow();
  const file = join(dir, "not-a-dir");
  writeFileSync(file, "{}");
  expect(() => inspectBrowserTurnDiagnostics(file)).toThrow("real trace directory");
  mkdirSync(join(dir, "empty"));
  expect(inspectBrowserTurnDiagnostics(join(dir, "empty")).sendAccepted).toBe(false);
}));
