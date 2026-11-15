import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { callTurnBroker, TurnBroker, type BrokerToolResult } from "../../src/adapters/chatgpt-web/turn-broker";

const [socketPath, directory, readyPath] = process.argv.slice(2);
if (!socketPath || !directory || !readyPath) throw new Error("Missing broker test fixture paths");

const broker = TurnBroker.forSocket(socketPath);
broker.enableCallJournal(directory);
await broker.listen();

const nativeIdentity = {
  threadId: "11111111-1111-4111-8111-111111111111",
  turnId: "22222222-2222-4222-8222-222222222222",
};
const home = dirname(directory);
const token = await broker.register({
  cwd: home, roots: [home], writableRoots: [home],
  sandboxPolicy: { type: "dangerFullAccess" },
  tools: [{ name: "mutating_tool", description: "Test operation", parameters: { type: "object" } }],
}, 60_000, "123456abcdef", nativeIdentity);
const { bindingId } = await callTurnBroker<{ bindingId: string }>(broker.socketPath, {
  method: "claim", token,
});
// The parent kills this process after the broker has delivered the call.
// Do not send a result or a retirement event: a real process crash leaves
// delivery_possible as the last durable record.
void callTurnBroker<BrokerToolResult>(broker.socketPath, {
  method: "invoke", bindingId, wireName: "mutating_tool", arguments: { privateText: "never-journal" },
}, null, AbortSignal.timeout(60_000)).catch(() => {});
const delivered = await broker.nextToolBatch(token);
if (delivered.length !== 1 || delivered[0]?.wireName !== "mutating_tool") {
  throw new Error("Expected one delivered native broker invocation");
}
writeFileSync(readyPath, delivered[0].callId);
