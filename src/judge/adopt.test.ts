import { describe, expect, it } from "vitest";
import { adoptQuestions, interpretAdopt, judgeAllowlistAdoption } from "./adopt.js";
import { KNOWLEDGE_KIND_IDS } from "./knowledge-kinds.js";
import type { ChoiceAnswer, Judge, JudgeResult } from "./types.js";

function kindAnswer(choice: string, confidence: number): ChoiceAnswer {
  const probabilities: Record<string, number> = {};
  const rest = KNOWLEDGE_KIND_IDS.filter((id) => id !== choice);
  const share = rest.length === 0 ? 0 : (1 - confidence) / rest.length;
  for (const id of KNOWLEDGE_KIND_IDS) {
    probabilities[id] = id === choice ? confidence : share;
  }
  return { type: "choice", choice, probabilities, confidence };
}

function answers(shouldAdopt: number, choice: string, confidence: number): JudgeResult {
  return {
    judgeId: "jev",
    answers: {
      should_adopt: { type: "noul", noul: shouldAdopt },
      kind: kindAnswer(choice, confidence),
    },
  };
}

describe("allowlist adoption", () => {
  it("asks should_adopt and reuses the knowledge kind choice", () => {
    const questions = adoptQuestions();
    expect(questions.should_adopt?.type).toBe("noul");
    expect(questions.kind?.type).toBe("choice");
    expect(questions.should_adopt?.instructions).toMatch(/allowlist/i);
  });

  it("proposes a confident ADR and skips noise", () => {
    const adr = interpretAdopt({
      path: "docs/adr/0002-keep-local.md",
      confidence: 0.8,
      answers: answers(0.96, "adr", 0.93).answers,
    });
    const noise = interpretAdopt({
      path: "docs/scratch.md",
      confidence: 0.8,
      answers: answers(0.04, "noise", 0.95).answers,
    });
    expect(adr.verdict).toBe("propose");
    expect(noise.verdict).toBe("skip");
  });

  it("does not send a secret file to Jev", async () => {
    const secret = "sk-test-abcdefghijklmnopqrstuvwxyz";
    const judge: Judge = {
      id: "jev",
      async evaluate() {
        throw new Error("Jev should not be called");
      },
    };
    const proposal = await judgeAllowlistAdoption({
      path: "docs/adr/0003.md",
      text: `Decision\n\n${secret}`,
      judge,
      confidence: 0.8,
    });
    expect(proposal.verdict).toBe("skip");
    expect(proposal.reason).toMatch(/secret/);
  });
});
