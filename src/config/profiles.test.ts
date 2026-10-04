import { describe, expect, it } from "vitest";
import { resolveProjectConnection } from "./connection.js";
import {
  createShareConfig,
  HINDSIGHT_CLOUD_API_URL,
  validateShareConfig,
} from "./profiles.js";
import { createDefaultConfig } from "./schema.js";

describe("share profiles", () => {
  it("requires baseUrl for lan", () => {
    expect(() =>
      validateShareConfig(createShareConfig({ profile: "lan" })),
    ).toThrow(/requires a non-secret base URL/);
  });

  it("defaults cloud MCP auth to api-key", () => {
    const share = createShareConfig({ profile: "hindsight-cloud" });
    expect(share.mcpAuth).toBe("api-key");
    validateShareConfig(share);
  });

  it("resolves cloud base URL and bank-scoped MCP", () => {
    const config = createDefaultConfig({
      name: "demo",
      bankId: "demo",
      deploymentProfile: "hindsight-cloud",
    });
    const share = createShareConfig({ profile: "hindsight-cloud" });
    const connection = resolveProjectConnection({
      config,
      share,
      env: {},
    });
    expect(connection.baseUrl).toBe(HINDSIGHT_CLOUD_API_URL);
    expect(connection.mcpUrl).toBe(
      "https://api.hindsight.vectorize.io/mcp/demo/",
    );
    expect(connection.serverName).toBe("hindsight-demo");
    expect(connection.skipDocker).toBe(true);
    expect(connection.requiresApiKey).toBe(true);
  });

  it("resolves lan base URL from share.json", () => {
    const config = createDefaultConfig({ name: "demo", bankId: "demo" });
    const share = createShareConfig({
      profile: "lan",
      baseUrl: "http://192.168.1.10:8888",
    });
    const connection = resolveProjectConnection({
      config,
      share,
      env: {},
    });
    expect(connection.baseUrl).toBe("http://192.168.1.10:8888");
    expect(connection.mcpUrl).toBe(
      "http://192.168.1.10:8888/mcp/demo/",
    );
  });
});
