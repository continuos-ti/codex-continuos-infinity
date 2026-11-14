import { writeFileSync } from "node:fs";
import { recordBrokerCallEvent } from "../../src/adapters/chatgpt-web/broker-call-journal";
import { nativeBrokerOwnerDigest } from "../../src/adapters/chatgpt-web/native-broker-owner";
import { TurnBroker } from "../../src/adapters/chatgpt-web/turn-broker";

const [socketPath, directory, readyPath] = process.argv.slice(2);
if (!socketPath || !directory || !readyPath) throw new Error("Missing broker test fixture paths");

const broker = TurnBroker.forSocket(socketPath);
broker.enableCallJournal(directory);
await broker.listen();

const nativeOwnerDigest = nativeBrokerOwnerDigest({
  threadId: "11111111-1111-4111-8111-111111111111",
  turnId: "22222222-2222-4222-8222-222222222222",
});
if (!nativeOwnerDigest) throw new Error("Invalid fixture owner identity");
const record = {
  directory,
  traceId: "123456abcdef",
  callId: `call_${"X".repeat(32)}`,
  wireName: "mutating_tool",
  nativeOwnerDigest,
};
recordBrokerCallEvent({ ...record, event: "queued" });
recordBrokerCallEvent({ ...record, event: "delivery_possible" });
writeFileSync(readyPath, "ready");
