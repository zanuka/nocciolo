import { describe, expect, it } from "vitest";
import {
  compositePriority,
  DEFAULT_PRIORITY_WEIGHTS,
  formatBudgetLines,
  parseBudget,
  priorityQuestions,
  rankByPriority,
} from "./priority.js";

describe("retain priority", () => {
  it("asks centrality, supersession, and fanout as atomic scores", () => {
    const questions = priorityQuestions();
    expect(Object.keys(questions)).toEqual([
      "centrality",
      "supersedes_existing",
      "agent_fanout",
    ]);
    expect(questions.centrality?.type).toBe("score");
    expect(questions.agent_fanout?.type).toBe("score");
    expect(questions.supersedes_existing?.type).toBe("noul");
  });

  it("ranks a changed ADR above a wording-only changelog", () => {
    const weights = DEFAULT_PRIORITY_WEIGHTS;
    const adr = compositePriority(
      {
        durability: 4,
        centrality: 4,
        supersedesExisting: 0.9,
        fanout: 4,
        containsSecret: 0.02,
        containsPii: 0.02,
      },
      weights,
    );
    const changelog = compositePriority(
      {
        durability: 0,
        centrality: 0,
        supersedesExisting: 0.05,
        fanout: 1,
        containsSecret: 0.02,
        containsPii: 0.02,
      },
      weights,
    );
    expect(adr).toBeGreaterThan(changelog);
  });

  it("uses config weights and subtracts secret risk", () => {
    const fanoutOnly = {
      durability: 0,
      centrality: 0,
      supersession: 0,
      fanout: 1,
      secretRisk: 0,
    };
    const ranked = rankByPriority(
      [
        { id: "adr", path: "docs/adr/0001.md", fanout: 0 },
        { id: "changelog", path: "docs/changelog.md", fanout: 4 },
      ],
      (item) => ({ fanout: item.fanout }),
      (item) => ({ path: item.path, id: item.id }),
      fanoutOnly,
    );
    expect(ranked.map((row) => row.item.id)).toEqual(["changelog", "adr"]);

    const clean = compositePriority({ durability: 4, containsSecret: 0 }, DEFAULT_PRIORITY_WEIGHTS);
    const risky = compositePriority(
      { durability: 4, containsSecret: 0.9 },
      DEFAULT_PRIORITY_WEIGHTS,
    );
    expect(clean).toBeGreaterThan(risky);
  });

  it("prints an ordered queue and a cutoff", () => {
    const lines = formatBudgetLines({
      budget: 1,
      weights: DEFAULT_PRIORITY_WEIGHTS,
      dryRun: true,
      ranked: [
        {
          id: "orto:docs/adr/0001.md#decision",
          priority: 0.98,
          signals: { durability: 4, centrality: 4, supersedesExisting: 0.9, fanout: 4, containsSecret: 0.02, containsPii: 0.02 },
        },
        {
          id: "orto:docs/changelog.md#notes",
          priority: 0.04,
          signals: { durability: 0, centrality: 0, supersedesExisting: 0.05, fanout: 1, containsSecret: 0.02, containsPii: 0.02 },
        },
      ],
    });
    const output = lines.join("\n");
    expect(output).toContain("[dry-run] Retain budget 1");
    expect(output.indexOf("docs/adr/0001.md")).toBeLessThan(output.indexOf("--- cutoff ---"));
    expect(output.indexOf("--- cutoff ---")).toBeLessThan(output.indexOf("docs/changelog.md"));
    expect(output).toContain("docs/changelog.md#notes");
    expect(output).toContain("pending");
  });

  it("rejects a budget that is not a positive integer", () => {
    expect(parseBudget("5")).toBe(5);
    expect(() => parseBudget("0")).toThrow(/Invalid --budget/);
    expect(() => parseBudget("1.5")).toThrow(/Invalid --budget "1.5"/);
  });
});
