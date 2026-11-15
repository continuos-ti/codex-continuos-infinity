import { readFileSync, writeFileSync } from "node:fs";
import type { CodexTool } from "../../src/types";
import { callTurnBroker, TurnBroker, type BrokerToolResult } from "../../src/adapters/chatgpt-web/turn-broker";

type FixtureConfig = {
  socketPath: string;
  journalDirectory: string;
  readyPath: string;
  traceId: string;
  nativeOwner: { threadId: string; turnId: string };
  cwd: string;
  tools: CodexTool[];
  wireName: string;
  arguments: Record<string, unknown>;
};

const configPath = process.argv[2];
if (!configPath) throw new Error("Missing isolated broker fixture configuration");
const config = JSON.parse(readFileSync(configPath, "utf8")) as FixtureConfig;

const broker = TurnBroker.forSocket(config.socketPath);
broker.enableCallJournal(config.journalDirectory);
await broker.listen();
const token = await broker.register({
  cwd: config.cwd, roots: [config.cwd], writableRoots: [config.cwd],
  sandboxPolicy: { type: "dangerFullAccess" }, tools: config.tools,
}, 60_000, config.traceId, config.nativeOwner);
const { bindingId } = await callTurnBroker<{ bindingId: string }>(broker.socketPath, {
  method: "claim", token,
});
// Deliberately leave the original IPC call unresolved; the parent kills this
// broker after the isolated provider accepts its real mutating operation.
void callTurnBroker<BrokerToolResult>(broker.socketPath, {
  method: "invoke", bindingId, wireName: config.wireName, arguments: config.arguments,
}, 60_000).catch(() => {});
const delivered = await broker.nextToolBatch(token);
if (delivered.length !== 1 || delivered[0]?.wireName !== config.wireName
  || delivered[0].readOnly !== false) {
  throw new Error("Staging crash fixture did not deliver exactly one mutating call");
}
// This temporary handoff is inside the disposable staging directory; it is
// removed after the smoke. The durable journal itself stores no arguments.
writeFileSync(config.readyPath, JSON.stringify(delivered[0]));
