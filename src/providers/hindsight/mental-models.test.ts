import { describe, expect, it } from "vitest";
import {
  buildStarterMentalModels,
  resolveRefreshAfterConsolidation,
  tagsForStarter,
  STARTER_MENTAL_MODELS,
} from "./mental-models.js";

describe("mental model starters", () => {
  it("differentiates auto vs manual refresh by default", () => {
    const models = buildStarterMentalModels({ projectName: "Demo" });
    const byId = new Map(models.map((m) => [m.id, m]));
    expect(byId.get("project-context")?.trigger.refresh_after_consolidation).toBe(
      true,
    );
    expect(
      byId.get("coding-standards")?.trigger.refresh_after_consolidation,
    ).toBe(false);
  });

  it("maps topic tags with any match for multi-tag architecture", () => {
    const architecture = STARTER_MENTAL_MODELS.find(
      (s) => s.id === "architecture-decisions",
    )!;
    expect(
      tagsForStarter({ spec: architecture, taggingMode: "topic-scoped" }),
    ).toEqual({
      tags: ["knowledge:architecture", "knowledge:decision"],
      tagsMatch: "any",
    });
  });

  it("resolves refresh policies", () => {
    expect(resolveRefreshAfterConsolidation("auto", "manual")).toBe(true);
    expect(resolveRefreshAfterConsolidation("manual", "auto")).toBe(false);
    expect(resolveRefreshAfterConsolidation("differentiated", "manual")).toBe(
      false,
    );
  });
});
