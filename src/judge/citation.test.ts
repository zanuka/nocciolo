import { describe, expect, it } from "vitest";
import {
  citationQuestions,
  formatCitationLines,
  interpretCitation,
  judgeSectionCitation,
} from "./citation.js";
import type { ChoiceAnswer, Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

const SECTION = "We use Postgres. The bank stays on the machine.";

function supportAnswer(choice: string, confidence: number): ChoiceAnswer {
  const ids = ["quoted", "implied", "unsupported"];
  const probabilities: Record<string, number> = {};
  const rest = ids.filter((id) => id !== choice);
  const share = rest.length === 0 ? 0 : (1 - confidence) / rest.length;
  for (const id of ids) {
    probabilities[id] = id === choice ? confidence : share;
  }
  return { type: "choice", choice, probabilities, confidence };
}

function answers(facts: ReadonlyArray<{ noul: number; choice: string; confidence: number }>): JudgeResult {
  const body: JudgeResult["answers"] = {};
  facts.forEach((fact, index) => {
    body[`supported_by_source_${index}`] = { type: "noul", noul: fact.noul };
    body[`support_${index}`] = supportAnswer(fact.choice, fact.confidence);
  });
  return { judgeId: "jev", answers: body };
}

describe("citation support", () => {
  it("rejects an extracted claim that the section does not contain", () => {
    const [decision] = interpretCitation({
      facts: ["We use MySQL."],
      confidence: 0.8,
      answers: answers([{ noul: 0.96, choice: "unsupported", confidence: 0.93 }]).answers,
    });
    expect(decision?.verdict).toBe("drop");
    expect(decision?.reason).toBe("unsupported");
    expect(decision?.support).toBe("unsupported");
  });

  it("accepts an extracted claim that quotes the section", () => {
    const [decision] = interpretCitation({
      facts: ["We use Postgres."],
      confidence: 0.8,
      answers: answers([{ noul: 0.96, choice: "quoted", confidence: 0.95 }]).answers,
    });
    expect(decision?.verdict).toBe("keep");
    expect(decision?.support).toBe("quoted");
  });

  it("reviews a fact when the citation answers are missing", () => {
    const [decision] = interpretCitation({
      facts: ["We use Postgres."],
      confidence: 0.8,
      answers: {},
    });
    expect(decision?.verdict).toBe("review");
  });

  it("asks every fact in one call and does not send a secret fact", async () => {
    const calls: JudgeEvaluateInput[] = [];
    const secret = "sk-test-abcdefghijklmnopqrstuvwxyz";
    const judge: Judge = {
      id: "jev",
      async evaluate(input) {
        calls.push(input);
        return answers([
          { noul: 0.96, choice: "quoted", confidence: 0.95 },
          { noul: 0.04, choice: "unsupported", confidence: 0.94 },
          { noul: 0.9, choice: "implied", confidence: 0.91 },
        ]);
      },
    };
    const result = await judgeSectionCitation({
      path: "docs/adr/0009.md",
      section: SECTION,
      facts: ["We use Postgres.", "We use MySQL.", "The bank is local.", secret],
      judge,
      confidence: 0.8,
    });
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]?.questions ?? {})).toEqual([
      "supported_by_source_0",
      "support_0",
      "supported_by_source_1",
      "support_1",
      "supported_by_source_2",
      "support_2",
    ]);
    expect(JSON.stringify(calls[0]?.state)).not.toContain(secret);
    expect(result.calls).toBe(1);
    expect(result.decisions.map((decision) => decision.verdict)).toEqual([
      "keep",
      "drop",
      "keep",
      "drop",
    ]);
    const printed = formatCitationLines({
      factId: "nocciolo:docs/adr/0009.md#decision",
      decisions: result.decisions,
      dryRun: true,
      calls: result.calls,
    }).join("\n");
    expect(printed).toContain("1 Jev call, 4 extracted fact(s)");
    expect(printed).not.toContain(secret);
    expect(printed).toContain("(fact text redacted)");
  });

  it("builds one noul and one choice per fact", () => {
    const questions = citationQuestions(2);
    expect(questions.supported_by_source_1?.type).toBe("noul");
    expect(questions.support_0?.type).toBe("choice");
  });
});
