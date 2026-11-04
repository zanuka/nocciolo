import { describe, expect, it } from "vitest";
import {
  buildDockerStopPlan,
  buildDockerUpPlan,
  formatDockerArgv,
  resolveLlmApiKey,
} from "./hindsight.js";

describe("buildDockerUpPlan", () => {
  it("builds a detached pull-always run for the official image", () => {
    const plan = buildDockerUpPlan({
      llmApiKey: "sk-test",
      llmKeyDisplay: "$OPENAI_API_KEY",
      tenantApiKey: "tenant-secret",
      tenantKeyDisplay: "$ORTO_HINDSIGHT_API_KEY",
    });
    expect(plan.argv[0]).toBe("docker");
    expect(plan.argv).toContain("-d");
    expect(plan.argv).toContain("--pull");
    expect(plan.argv).toContain("always");
    expect(plan.argv).toContain("ghcr.io/vectorize-io/hindsight:latest");
    expect(plan.argv).toContain("HINDSIGHT_API_LLM_API_KEY=sk-test");
    expect(plan.argv).toContain("HINDSIGHT_API_TENANT_API_KEY=tenant-secret");
    expect(plan.argv).toContain("HINDSIGHT_CP_DATAPLANE_API_KEY=tenant-secret");
    expect(plan.display).toContain("HINDSIGHT_API_LLM_API_KEY=$OPENAI_API_KEY");
    expect(plan.display).toContain(
      "HINDSIGHT_API_TENANT_API_KEY=$ORTO_HINDSIGHT_API_KEY",
    );
    expect(plan.display).not.toContain("sk-test");
    expect(plan.display).not.toContain("tenant-secret");
    expect(plan.apiUrl).toBe("http://localhost:8888");
    expect(plan.uiUrl).toBe("http://localhost:9999");
  });

  it("warns when LLM key is missing", () => {
    const plan = buildDockerUpPlan({});
    expect(plan.envHints.some((h) => /LLM API key/i.test(h))).toBe(true);
  });
});

describe("buildDockerStopPlan", () => {
  it("force-removes the container", () => {
    const plan = buildDockerStopPlan("hindsight");
    expect(plan.argv).toEqual(["docker", "rm", "-f", "hindsight"]);
  });
});

describe("default names", () => {
  it("uses hindsight as the default container and volume", () => {
    const plan = buildDockerUpPlan({});
    expect(plan.containerName).toBe("hindsight");
    expect(plan.argv).toContain("hindsight");
    expect(plan.argv).toContain("hindsight-data:/home/hindsight/.pg0");
  });
});

describe("formatDockerArgv", () => {
  it("quotes values with spaces", () => {
    expect(formatDockerArgv(["docker", "run", "-e", "FOO=bar baz"])).toContain(
      "'FOO=bar baz'",
    );
  });
});

describe("resolveLlmApiKey", () => {
  it("prefers HINDSIGHT_API_LLM_API_KEY", () => {
    expect(
      resolveLlmApiKey({
        HINDSIGHT_API_LLM_API_KEY: "a",
        OPENAI_API_KEY: "b",
      }),
    ).toBe("a");
  });
});
