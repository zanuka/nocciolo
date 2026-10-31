import { describe, expect, it } from "vitest";
import {
  OBSERVATION_RELATIONS,
  RELATION_CHOICE_MAX_OVERLAPS,
  relationQuestions,
} from "./relations.js";

describe("relationQuestions", () => {
  it("asks one relation choice when the overlap list is short", () => {
    const questions = relationQuestions([
      { id: "obs-mysql", summary: "We use MySQL." },
    ]);
    expect(Object.keys(questions)).toEqual(["relation"]);
    const relation = questions.relation;
    expect(relation?.type).toBe("choice");
    if (relation?.type !== "choice") {
      return;
    }
    expect(Object.keys(relation.criteria)).toEqual([...OBSERVATION_RELATIONS]);
    const supersedes = relation.criteria.supersedes;
    expect(supersedes).toMatchObject({
      what: expect.any(String),
      not_for: expect.any(String),
      examples: expect.any(Array),
    });
    expect(JSON.stringify(supersedes)).toMatch(/Postgres/);
    expect(JSON.stringify(supersedes)).toMatch(/MySQL/);
    expect(RELATION_CHOICE_MAX_OVERLAPS).toBeGreaterThanOrEqual(1);
  });

  it("splits a noul per overlap when the list is long", () => {
    const overlaps = [0, 1, 2, 3].map((index) => ({
      id: `obs-${index}`,
      summary: `claim ${index}`,
    }));
    const questions = relationQuestions(overlaps);
    expect(Object.keys(questions)).toEqual([
      "conflicts_with_0",
      "conflicts_with_1",
      "conflicts_with_2",
      "conflicts_with_3",
    ]);
    const first = questions.conflicts_with_0;
    expect(first?.type).toBe("noul");
    if (first?.type === "noul") {
      expect(String(first.instructions)).toContain("obs-0");
    }
  });

  it("asks nothing when no observation id is present", () => {
    expect(relationQuestions([{ summary: "We use MySQL." }])).toEqual({});
  });
});
