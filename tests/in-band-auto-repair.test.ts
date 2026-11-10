import { describe, expect, test } from "bun:test";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";
import { inBandRepairTaskPrompt, isSafeInBandAutoRepairFailure } from "../src/adapters/chatgpt-web/in-band-auto-repair";

const stall = new ChatGptWebAdapterError("Missing final answer", {
  code: "chatgpt_stalled_same_turn", status: 503, errorType: "server_error", retryable: false,
});
const eligible = { accepted: true, localTools: true, retained: true, cancelled: false, compaction: false, activeToolCalls: 0 };

describe("in-band event-driven repair guards", () => {
  test("starts only for accepted, retained, tool-capable stalls", () => {
    expect(isSafeInBandAutoRepairFailure(stall, eligible)).toBe(true);
    const incomplete = new ChatGptWebAdapterError("DOM incomplete", {
      code: "chatgpt_response_incomplete", status: 502, errorType: "server_error", retryable: false,
    });
    expect(isSafeInBandAutoRepairFailure(incomplete, eligible)).toBe(true);
  });
  test("never autorepairs before acceptance, on cancelled rounds or while MCP tools are active", () => {
    for (const change of [
      { accepted: false }, { localTools: false }, { retained: false },
      { cancelled: true }, { compaction: true }, { activeToolCalls: 1 },
    ]) expect(isSafeInBandAutoRepairFailure(stall, { ...eligible, ...change })).toBe(false);
  });
  test("does not recover auth, approval or arbitrary upstream errors", () => {
    for (const code of ["chatgpt_session_expired", "chatgpt_tool_approval_required", "other"]) {
      const error = new ChatGptWebAdapterError("bad", {
        code, status: 503, errorType: "server_error", retryable: false,
      });
      expect(isSafeInBandAutoRepairFailure(error, eligible)).toBe(false);
    }
  });
  test("repair request is a distinct bounded instruction with local trace, one attempt and no replays", () => {
    const prompt = inBandRepairTaskPrompt({
      traceId: "bd0283ca5775", code: "chatgpt_stalled_same_turn",
      error: "stalled\ntrace",
      diagnosticsDirectory: "C:/Users/test/.codex-chatgpt-web/diagnostics/browser-turns",
    });
    expect(prompt).toContain("bd0283ca5775");
    expect(prompt).toContain("ContinuosWebIntegracao");
    expect(prompt).toContain("CODEX CONTINUOS INFINITY");
    expect(prompt).toContain("UMA VEZ");
    expect(prompt).toContain("Nao repita prompt original");
    expect(prompt).not.toContain("stalled\ntrace");
    expect(prompt.length).toBeLessThan(5000);
  });
});
