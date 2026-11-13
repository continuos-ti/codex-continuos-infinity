import { TurnBroker } from "../adapters/chatgpt-web/turn-broker";
import { validateIsolatedDevExternalGateway, type AppConfig } from "../config";
import { inspectExternalGatewayHealth } from "../doctor";
import { tunnelStatus } from "../tunnel";
import { join } from "node:path";
import { DEV_CONFIG_PURPOSE } from "./constants";

interface DevTransportStatus {
  ready: boolean;
  detail?: string;
  ok?: boolean;
}

interface DevTransportDependencies {
  status?: (config: AppConfig) => DevTransportStatus | Promise<DevTransportStatus>;
}

export interface DevChatTransport {
  config: AppConfig;
  broker: TurnBroker;
  close(): Promise<void>;
}

function assertDevTransportConfig(config: AppConfig): void {
  if (config.purpose !== DEV_CONFIG_PURPOSE) {
    throw new Error("Repository DEV transport requires an isolated dev-harness configuration");
  }
  if (config.mode !== "full") {
    throw new Error("Repository DEV chat requires a completed Full harness configuration");
  }
  if (config.mcpTransport === "external-cloudflare") {
    if (!config.externalGateway) {
      throw new Error("Repository DEV chat requires an external Cloudflare gateway configuration");
    }
    validateIsolatedDevExternalGateway(config.externalGateway);
  } else if (!config.tunnel) {
    throw new Error("Repository DEV chat requires completed Full harness tunnel credentials");
  }
}

/**
 * Attach a named repository DEV chat to its isolated broker after validating the configured MCP
 * transport. The CLI owns only its turn broker; the launcher owns transport supervision.
 */
export async function startDevChatTransport(
  config: AppConfig,
  devHome: string,
  dependencies: DevTransportDependencies = {},
): Promise<DevChatTransport> {
  assertDevTransportConfig(config);
  let runtime: DevTransportStatus;
  if (dependencies.status) {
    runtime = await dependencies.status(config);
  } else if (config.mcpTransport === "external-cloudflare") {
    const inspected = await inspectExternalGatewayHealth(config.externalGateway!);
    runtime = {
      ready: inspected.ready,
      ok: inspected.ready,
      ...(!inspected.ready ? { detail: inspected.detail } : {}),
    };
  } else {
    runtime = tunnelStatus(config);
  }
  if (!runtime.ready || runtime.ok === false) {
    throw new Error(
      `The configured DEV MCP transport is not ready: ${runtime.detail ?? "no readiness detail"}. Open the DEV launcher and complete MCP setup first`,
    );
  }

  const broker = TurnBroker.forSocket(config.brokerSocketPath);
  broker.enableCallJournal(join(devHome, "diagnostics", "broker-calls"));
  await broker.listen();
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await broker.close();
  };

  return { config, broker, close };
}
