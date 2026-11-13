import { expect, test } from "bun:test";
import { CHATGPT_CONNECTOR_NAME, DEV_CHATGPT_CONNECTOR_NAME, resolveInteractionConnectorIdentities } from "../src/config";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const launcher = require("../launcher/electron/connector-identity.cjs");
const devPlugin = require("../integrations/dev-connector-plugin/plugin.json");
test("ContinuosWebIntegracao is the canonical production connector", () => {
  expect(CHATGPT_CONNECTOR_NAME).toBe("ContinuosWebIntegracao");
  expect(resolveInteractionConnectorIdentities("automatic").appName).toBe("ContinuosWebIntegracao");
  expect(launcher.CURRENT_CONNECTOR_NAME).toBe("ContinuosWebIntegracao");
  expect(launcher.requireCurrentRuntimeConnectorName("ContinuosWebIntegracao")).toBe("ContinuosWebIntegracao");
});
test("Custom connector name can remain distinct from Zero Risk", () => {
  const ids=resolveInteractionConnectorIdentities("manual");
  expect(ids.automaticAppName).toBe("ContinuosWebIntegracao");
  expect(ids.manualAppName).toBe("Codex Zero Risk");
});

test("isolated DEV connector package matches the browser adapter identity", () => {
  expect(DEV_CHATGPT_CONNECTOR_NAME).toBe("ContinuosWebIntegracao DEV Web");
  expect(devPlugin.extensions["com.openai"].interface.displayName).toBe(DEV_CHATGPT_CONNECTOR_NAME);
});
