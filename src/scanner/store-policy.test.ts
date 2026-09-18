import { describe, expect, it } from "vitest";
import { checkStoreDeny } from "./store-policy.js";

describe("checkStoreDeny", () => {
  it("denies AGENTS.md even with --files", () => {
    const result = checkStoreDeny("AGENTS.md", "/tmp/project", {
      explicit: true,
    });
    expect(result.denied).toBe(true);
    expect(result.reason).toMatch(/integration surface/i);
  });

  it("allows durable markdown", () => {
    const result = checkStoreDeny("docs/architecture.md", "/tmp/project");
    expect(result.denied).toBe(false);
  });
});
