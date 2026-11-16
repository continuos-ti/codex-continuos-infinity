const { test } = require("node:test");
const assert = require("node:assert/strict");
const { usesExternalCloudflareGateway } = require("../electron/runtime-supervisor.cjs");
const { CURRENT_CONNECTOR_NAME } = require("../electron/connector-identity.cjs");

test("Cloudflare transport requires explicit configuration and automatic full mode", () => {
  assert.equal(CURRENT_CONNECTOR_NAME, "ContinuosWebIntegracao");
  const config = {mode:"full", browserInteractionMode:"automatic", appName:CURRENT_CONNECTOR_NAME, mcpTransport:"external-cloudflare"};
  assert.equal(usesExternalCloudflareGateway(config),true);
  assert.equal(usesExternalCloudflareGateway({...config, appName:"Authorized Custom Connector"}),true);
  assert.equal(usesExternalCloudflareGateway({...config, mcpTransport:"openai-tunnel"}),false);
  assert.equal(usesExternalCloudflareGateway({...config, mcpTransport:undefined}),false);
  assert.equal(usesExternalCloudflareGateway({...config, mode:"browser-only"}),false);
  assert.equal(usesExternalCloudflareGateway({...config, browserInteractionMode:"manual"}),false);
});

test("the Cloudflare branch is supported by the built runtime", () => {
  const supervisor=require("../electron/runtime-supervisor.cjs");
  assert.equal(typeof supervisor.cloudflareHealth,"function");
  assert.equal(typeof supervisor.RuntimeSupervisor,"function");
});
