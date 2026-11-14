import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatGptWebTraceId, createChatGptWebAdapter } from "../src/adapters/chatgpt-web/index";
import type { AdapterEvent, CodexParsedRequest, CodexProviderConfig } from "../src/types";

/** The adapter must record missing trusted cwd before starting a browser or dispatching MCP. */
test("pre-send missing cwd produces one private incident with current trace and no browser submission", async () => {
  const home = mkdtempSync(join(tmpdir(), "codex-preflight-runtime-"));
  const previous = process.env.CODEX_CONTINUOS_INFINITY_HOME;
  process.env.CODEX_CONTINUOS_INFINITY_HOME = home;
  try {
    const provider: CodexProviderConfig = {
      adapter: "chatgpt-web", baseUrl: "browser://trusted-cwd-preflight-fixture",
      chatgptWeb: { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true },
    };
    const request: CodexParsedRequest = {
      modelId: "gpt-5.6-sol", stream: true,
      context: { tools: [], messages: [{ role: "user", content: "Read current workspace", timestamp: 1 }] },
      options: { reasoning: "high" },
      _rawBody: {
        client_metadata: { "x-codex-turn-metadata": JSON.stringify({
          thread_id: "test-preflight-thread", turn_id: "test-preflight-turn",
        }) },
        input: [{ type: "message", role: "user", id: "msg_current_instruction",
          internal_chat_message_metadata_passthrough: { turn_id: "test-preflight-turn" },
          content: [{ type: "input_text", text: "Read current workspace" }],
        }],
      },
    };
    const traceId = chatGptWebTraceId(provider, request);
    const events: AdapterEvent[] = [];
    await expect(createChatGptWebAdapter(provider).runTurn!(request, { headers: new Headers() },
      event => events.push(event))).rejects.toThrow("missing cwd");
    expect(events.some(event => event.type === "tool_call_start" || event.type === "done")).toBe(false);
    expect(events.filter(event => event.type === "text_delta" && event.phase === "commentary").map(event =>
      event.type === "text_delta" ? event.text : "")).toContain(
      "Codex Continuos Infinity: a tentativa atual não comprovou o contexto nativo desta tarefa. Esta tentativa foi bloqueada antes de enviar um novo prompt ou despachar ferramentas. Chamadas anteriores da tarefa continuam sujeitas à reconciliação. Aguardando contexto confiável válido.",
    );
    const directory = join(home, "diagnostics", "preflight-incidents");
    expect(readdirSync(directory)).toEqual([`${traceId}.json`]);
    const path = join(directory, `${traceId}.json`);
    expect(existsSync(path)).toBe(true);
    const record = JSON.parse(readFileSync(path, "utf8"));
    expect(record).toMatchObject({ traceId, phase: "before_submission", thisAttemptSubmitted: false, priorSubmissionState: "unknown",
      currentAttemptToolDispatches: 0, checkpoint: "preflight_blocked", autoRepairAttempts: 0 });
    expect(JSON.stringify(record)).not.toContain("Read current workspace");
  } finally {
    if (previous === undefined) delete process.env.CODEX_CONTINUOS_INFINITY_HOME;
    else process.env.CODEX_CONTINUOS_INFINITY_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
});