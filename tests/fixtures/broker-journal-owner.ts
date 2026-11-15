import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { callTurnBroker, TurnBroker, type BrokerToolResult } from "../../src/adapters/chatgpt-web/turn-broker";

const [socketPath, directory, readyPath, mode = "pending"] = process.argv.slice(2);
if (!socketPath || !directory || !readyPath) throw new Error("Missing broker test fixture paths");
if (mode !== "pending" && mode !== "completed" && mode !== "completed_readonly") {
  throw new Error("Unknown broker crash fixture mode");
}

const broker = TurnBroker.forSocket(socketPath);
broker.enableCallJournal(directory);
await broker.listen();

const nativeIdentity = {
  threadId: "11111111-1111-4111-8111-111111111111",
  turnId: "22222222-2222-4222-8222-222222222222",
};
const home = dirname(directory);
const toolName = mode === "completed_readonly" ? "read_tool" : "mutating_tool";
const token = await broker.register({
  cwd: home, roots: [home], writableRoots: [home],
  sandboxPolicy: { type: "dangerFullAccess" },
  tools: [{ name: toolName, description: "Test operation", parameters: mode === "completed_readonly"
    ? { type: "object", properties: {}, "x-codex-read-only": true }
    : { type: "object" } }],
}, 60_000, "123456abcdef", nativeIdentity);
const { bindingId } = await callTurnBroker<{ bindingId: string }>(broker.socketPath, {
  method: "claim", token,
});
// The parent kills this process after the broker has delivered the call.
// Do not send a result or a retirement event: a real process crash leaves
// delivery_possible as the last durable record.
const invocation = callTurnBroker<BrokerToolResult>(broker.socketPath, {
  method: "invoke", bindingId, wireName: toolName, arguments: { privateText: "never-journal" },
}, null, AbortSignal.timeout(60_000));
// A pending call is purposefully abandoned by the parent. Attach a rejection
// handler for the crash boundary without removing the live invocation.
void invocation.catch(() => {});
const delivered = await broker.nextToolBatch(token);
if (delivered.length !== 1 || delivered[0]?.wireName !== toolName) {
  throw new Error("Expected one delivered native broker invocation");
}
if (mode === "completed" || mode === "completed_readonly") {
  const result: BrokerToolResult = {
    content: [{ type: "text", text: "private-result-not-in-journal" }],
  };
  broker.completeTool(token, delivered[0].callId, result);
  if (JSON.stringify(await invocation) !== JSON.stringify(result)) {
    throw new Error("Broker did not return the exact sealed result");
  }
}
writeFileSync(readyPath, delivered[0].callId);
