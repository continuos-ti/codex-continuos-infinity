import { createHash } from "node:crypto";

interface McpRequestIdentity {
  sessionId?: string;
  requestId: string | number;
}

interface FencedRequest {
  digest: string;
  outcome?: Promise<unknown>;
}

/**
 * The MCP SDK supplies the JSON-RPC request ID from the actual transport, rather than a value
 * supplied inside the model's tool arguments. The stdio bridge has one session per process.
 * A repeated ID within that session must never dispatch a second native effect.
 *
 * Completed results remain available briefly for a lost-reply retry. Their entries then become
 * permanent in-process tombstones. After a process crash the original identity cannot be proven,
 * so this fence deliberately grants no cross-process replay authorization.
 */
export class McpRequestFence {
  private readonly requests = new Map<string, FencedRequest>();

  constructor(
    private readonly maxRequests = 100_000,
    private readonly resultRetentionMs = 9 * 60_000,
  ) {}

  async run<T>(
    identity: McpRequestIdentity,
    toolName: string,
    toolInput: unknown,
    invoke: () => Promise<T> | T,
  ): Promise<T> {
    const key = JSON.stringify([identity.sessionId ?? null, typeof identity.requestId, identity.requestId]);
    const canonicalInput = JSON.stringify([toolName, toolInput], (_key, value: unknown) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
      }
      return value;
    });
    const digest = createHash("sha256").update(canonicalInput).digest("hex");
    const prior = this.requests.get(key);
    if (prior) {
      if (prior.digest !== digest) {
        throw new Error("MCP request ID was reused for a different tool or arguments; native invocation refused");
      }
      if (!prior.outcome) {
        throw new Error("MCP request was previously handled; result expired and execution state must be reconciled before retry");
      }
      return prior.outcome as Promise<T>;
    }
    if (this.requests.size >= this.maxRequests) {
      throw new Error("MCP request identity fence reached its session limit; native invocation refused");
    }

    const entry: FencedRequest = { digest };
    this.requests.set(key, entry);
    // Reserve the ID synchronously, before invoking or awaiting any tool operation.
    const outcome = Promise.resolve().then(invoke);
    entry.outcome = outcome;
    const retireResult = () => {
      const timer = setTimeout(() => { entry.outcome = undefined; }, this.resultRetentionMs);
      timer.unref?.();
    };
    void outcome.then(retireResult, retireResult);
    return outcome;
  }
}
