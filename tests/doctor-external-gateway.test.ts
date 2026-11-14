import { expect, test } from "bun:test";
import { inspectExternalGatewayHealth } from "../src/doctor";

const externalGateway = {
  mcpUrl: "https://gateway.example.test/mcp",
  healthUrl: "https://gateway.example.test/health",
  expectedService: "ContinuosWebIntegracao",
};

test("external gateway health requires HTTP success and the configured service identity", async () => {
  let requestedUrl = "";
  let redirectMode: RequestRedirect | undefined;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input);
    redirectMode = init?.redirect;
    return new Response(JSON.stringify({ status: "ok", service: "ContinuosWebIntegracao" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  await expect(inspectExternalGatewayHealth(externalGateway, fetchImpl)).resolves.toEqual({ ready: true });
  expect(requestedUrl).toBe(externalGateway.healthUrl);
  expect(redirectMode).toBe("error");
});

test("external gateway health reports an HTTP failure", async () => {
  const fetchImpl = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

  await expect(inspectExternalGatewayHealth(externalGateway, fetchImpl)).resolves.toEqual({
    ready: false,
    detail: "Gateway returned HTTP 401",
  });
});

test("external gateway health rejects a mismatched service identity", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ status: "ok", service: "other" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as unknown as typeof fetch;

  await expect(inspectExternalGatewayHealth(externalGateway, fetchImpl)).resolves.toEqual({
    ready: false,
    detail: "Unexpected Cloudflare gateway identity",
  });
});
