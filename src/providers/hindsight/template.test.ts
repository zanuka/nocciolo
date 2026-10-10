import { generateHindsightBankTemplate } from "./template.js";

describe("generateHindsightBankTemplate", () => {
  it("produces a valid version-1 Hindsight bank template", () => {
    const template = generateHindsightBankTemplate({
      projectName: "Acme App",
      bankId: "acme-app",
    });

    expect(template.version).toBe("1");
    expect(template.bank.retain_extraction_mode).toBe("verbose");
    expect(template.bank.retain_mission).toContain("Acme App");
    expect(template.bank.entity_labels.length).toBeGreaterThan(0);
    expect(template.mental_models.some((m) => m.id === "project-context")).toBe(
      true,
    );
    expect(template.directives.length).toBeGreaterThan(0);
    expect(template.directives.every((d) => d.is_active)).toBe(true);
  });

  it("aligns mental model tags with seed retain tags for safe refresh", () => {
    const template = generateHindsightBankTemplate({
      projectName: "Acme App",
      bankId: "acme-app",
    });

    const byId = new Map(template.mental_models.map((m) => [m.id, m]));

    expect(byId.get("project-context")?.tags).toEqual(["nocciolo"]);
    expect(byId.get("project-context")?.trigger.tags_match).toBeUndefined();

    expect(byId.get("architecture-decisions")?.tags).toEqual([
      "knowledge:architecture",
      "knowledge:decision",
    ]);
    expect(byId.get("architecture-decisions")?.trigger.tags_match).toBe("any");

    expect(byId.get("coding-standards")?.tags).toEqual(["knowledge:standard"]);
    expect(byId.get("coding-standards")?.trigger.tags_match).toBeUndefined();
    expect(byId.get("project-context")?.trigger.refresh_after_consolidation).toBe(
      true,
    );
    expect(
      byId.get("architecture-decisions")?.trigger.refresh_after_consolidation,
    ).toBe(true);
    expect(
      byId.get("coding-standards")?.trigger.refresh_after_consolidation,
    ).toBe(false);
  });

  it("supports project-wide tagging and manual refresh policy", () => {
    const template = generateHindsightBankTemplate({
      projectName: "Acme App",
      bankId: "acme-app",
      taggingMode: "project-wide",
      refreshPolicy: "manual",
      mentalModelIds: ["project-context", "coding-standards"],
    });

    expect(template.mental_models.map((m) => m.id)).toEqual([
      "project-context",
      "coding-standards",
    ]);
    expect(
      template.mental_models.every((m) => m.tags.join(",") === "nocciolo"),
    ).toBe(true);
    expect(
      template.mental_models.every(
        (m) => m.trigger.refresh_after_consolidation === false,
      ),
    ).toBe(true);
  });
});
