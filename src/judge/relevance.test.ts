import { describe, expect, it } from "vitest";
import type { CandidateFact } from "../extractor/types.js";
import type { Judge, JudgeResult } from "./types.js";
import {
  decideRelevance,
  judgeSeedRelevance,
  noulBand,
  relevanceQuestions,
} from "./relevance.js";

const ADR_TEXT = `# ADR 0001: Keep the bank local

## Decision

We keep the Hindsight bank on the machine. This architecture decision is a project invariant and a standard for later integrations.
`;

const CHANGELOG_TEXT = `# Changelog

## Notes

This generated changelog is a badge wall and a table of contents for an API dump. Meeting notes and a TODO pile were pasted under the release heading.
`;

const BADGE_TEXT = `# Badges

## Shields

This badge wall lists generated status images. It is not a decision, invariant, or standard.
`;

const TOC_TEXT = `# Guide

## Map

Table of contents for the generated API dump. The links below are navigation, not architecture.
`;

function fact(input: {
  id: string;
  path: string;
  title: string;
  content: string;
  commit?: string;
}): CandidateFact {
  return {
    id: input.id,
    title: input.title,
    content: input.content,
    knowledgeKind: "decision",
    score: 10,
    provenance: {
      sourcePath: input.path,
      kind: "docs",
      ...(input.commit !== undefined ? { commit: input.commit } : {}),
    },
  };
}

function jevResult(input: {
  isDurable: number;
  isEphemeral: number;
  inScope: number;
  durability?: number;
  durabilityConfidence?: number;
  fellBack?: boolean;
}): JudgeResult {
  return {
    judgeId: "jev",
    ...(input.fellBack ? { fellBackFromJev: true } : {}),
    answers: {
      is_durable: { type: "noul", noul: input.isDurable },
      is_ephemeral: { type: "noul", noul: input.isEphemeral },
      in_scope: { type: "noul", noul: input.inScope },
      durability: {
        type: "score",
        score: input.durability ?? 3,
        legend: { "0": "Ephemeral", "4": "Constitutional" },
        probabilities: { "3": 1 },
        confidence: input.durabilityConfidence ?? 0.91,
      },
    },
  };
}

describe("relevanceQuestions", () => {
  it("asks durability, ephemerality, scope, and a 0-4 score in one call", () => {
    const questions = relevanceQuestions();
    expect(Object.keys(questions)).toEqual([
      "is_durable",
      "is_ephemeral",
      "in_scope",
      "durability",
    ]);
    expect(questions.durability?.type).toBe("score");
    if (questions.durability?.type === "score") {
      expect(questions.durability.criteria).toHaveLength(5);
      expect(questions.durability.criteria[0]).toMatch(/Ephemeral/);
      expect(questions.durability.criteria[4]).toMatch(/Constitutional/);
    }
  });
});

describe("noulBand", () => {
  it("treats --confidence as a confident yes and 1 - confidence as a confident no", () => {
    expect(noulBand(0.8, 0.8)).toBe("yes");
    expect(noulBand(0.2, 0.8)).toBe("no");
    expect(noulBand(0.5, 0.8)).toBe("uncertain");
    expect(noulBand(0.79, 0.8)).toBe("uncertain");
  });
});

describe("decideRelevance", () => {
  it("does not skip a known ADR when Jev is confident it is durable and in scope", () => {
    const decision = decideRelevance(
      jevResult({ isDurable: 0.96, isEphemeral: 0.04, inScope: 0.93, durability: 4 }),
      0.8,
    );
    expect(decision.action).toBe("retain");
    expect(decision.heuristicVsJev).toBe("agree");
    expect(ADR_TEXT).toMatch(/Decision/);
  });

  it("skips a changelog when Jev is confident it is ephemeral and not durable", () => {
    const decision = decideRelevance(
      jevResult({ isDurable: 0.05, isEphemeral: 0.97, inScope: 0.9, durability: 0 }),
      0.8,
    );
    expect(decision.action).toBe("skip");
    expect(decision.reason).toBe("ephemeral and not durable");
    expect(CHANGELOG_TEXT).toMatch(/changelog/i);
  });

  it("skips badge and TOC fixtures when Jev is confident", () => {
    const badge = decideRelevance(
      jevResult({ isDurable: 0.08, isEphemeral: 0.95, inScope: 0.88, durability: 0 }),
      0.8,
    );
    const toc = decideRelevance(
      jevResult({ isDurable: 0.04, isEphemeral: 0.99, inScope: 0.7, durability: 0 }),
      0.8,
    );
    expect(badge.action).toBe("skip");
    expect(toc.action).toBe("skip");
    expect(BADGE_TEXT).toMatch(/badge wall/i);
    expect(TOC_TEXT).toMatch(/Table of contents/);
  });

  it("skips a confident out-of-scope section", () => {
    const decision = decideRelevance(
      jevResult({ isDurable: 0.92, isEphemeral: 0.05, inScope: 0.1 }),
      0.8,
    );
    expect(decision.action).toBe("skip");
    expect(decision.reason).toBe("out of scope");
  });

  it("keeps a low-confidence answer in review instead of skipping or retaining", () => {
    const decision = decideRelevance(
      jevResult({ isDurable: 0.55, isEphemeral: 0.48, inScope: 0.61 }),
      0.8,
    );
    expect(decision.action).toBe("review");
    expect(decision.heuristicVsJev).toBe("review");
    expect(decision.reason).toMatch(/confidence below 0\.80/);
  });

  it("does not skip when ephemeral is high but durability is uncertain", () => {
    const decision = decideRelevance(
      jevResult({ isDurable: 0.5, isEphemeral: 0.96, inScope: 0.93 }),
      0.8,
    );
    expect(decision.action).toBe("review");
  });

  it("keeps the heuristic candidate when Jev falls back", () => {
    const decision = decideRelevance(
      jevResult({
        isDurable: 0,
        isEphemeral: 0,
        inScope: 0,
        fellBack: true,
      }),
      0.8,
    );
    expect(decision.action).toBe("retain");
    expect(decision.heuristicVsJev).toBe("fallback");
  });
});

describe("judgeSeedRelevance", () => {
  it("sends path, heading, text, bank mission, and source commit in one fan-out", async () => {
    const calls: Array<{ state: unknown; questionIds: string[] }> = [];
    const judge: Judge = {
      id: "jev",
      async evaluate(input) {
        calls.push({
          state: input.state,
          questionIds: Object.keys(input.questions),
        });
        return jevResult({ isDurable: 0.96, isEphemeral: 0.04, inScope: 0.93 });
      },
    };

    const rows = await judgeSeedRelevance({
      facts: [
        fact({
          id: "nocciolo:docs/adr/0001-local-bank.md#document",
          path: "docs/adr/0001-local-bank.md",
          title: "ADR 0001: Keep the bank local",
          content: ADR_TEXT,
          commit: "abc123",
        }),
      ],
      judge,
      confidence: 0.8,
      mission: "Hold durable decisions for Fixture.",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.questionIds).toEqual([
      "is_durable",
      "is_ephemeral",
      "in_scope",
      "durability",
    ]);
    expect(calls[0]?.state).toEqual({
      path: "docs/adr/0001-local-bank.md",
      heading: "ADR 0001: Keep the bank local",
      text: ADR_TEXT.trim(),
      bankMission: "Hold durable decisions for Fixture.",
      sourceCommit: "abc123",
    });
    expect(rows[0]?.action).toBe("retain");
  });

  it("does not call Jev when the section contains a secret, and does not skip it", async () => {
    let called = false;
    const judge: Judge = {
      id: "jev",
      async evaluate() {
        called = true;
        return jevResult({ isDurable: 0, isEphemeral: 1, inScope: 0 });
      },
    };
    const rows = await judgeSeedRelevance({
      facts: [
        fact({
          id: "nocciolo:docs/adr/0002.md#document",
          path: "docs/adr/0002.md",
          title: "Decision",
          content: `Keep the bank local.\n\nsk-test-abcdefghijklmnopqrstuvwxyz`,
        }),
      ],
      judge,
      confidence: 0.8,
      mission: "Hold durable decisions.",
    });
    expect(called).toBe(false);
    expect(rows[0]?.action).toBe("retain");
    expect(rows[0]?.heuristicVsJev).toBe("unjudged");
    expect(rows[0]?.reason).toMatch(/secret pattern/);
    expect(rows[0]?.reason).not.toContain("sk-test-abcdefghijklmnopqrstuvwxyz");
  });
});
