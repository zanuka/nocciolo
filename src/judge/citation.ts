import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_PATH_MAX_CHARS,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type {
  ChoiceQuestion,
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  NoulQuestion,
} from "./types.js";

const CITATION_FACT_TEXT_MAX_CHARS = 400;

export const CITATION_FACT_MAX = 12;
export const CITATION_SUPPORTS = ["quoted", "implied", "unsupported"] as const;

export type CitationSupport = (typeof CITATION_SUPPORTS)[number];
export type CitationVerdict = "keep" | "drop" | "review";

export interface CitationFactRead {
  index: number;
  text: string;
  verdict: CitationVerdict;
  support?: CitationSupport;
  supportConfidence?: number;
  supportedBySource?: number;
  supportedBand?: NoulBand;
  reason: string;
}

export function citationQuestions(count: number): Record<string, JudgeQuestion> {
  const questions: Record<string, JudgeQuestion> = {};
  for (let index = 0; index < count; index += 1) {
    questions[`supported_by_source_${index}`] = supportedBySourceQuestion(index);
    questions[`support_${index}`] = supportChoice(index);
  }
  return questions;
}

export function interpretCitation(input: {
  facts: readonly string[];
  answers: Record<string, JudgeAnswer>;
  confidence: number;
}): CitationFactRead[] {
  return input.facts.map((text, index) =>
    interpretOne(index, text, input.answers, input.confidence),
  );
}

export interface SectionCitation {
  decisions: CitationFactRead[];
  calls: number;
  fellBack: boolean;
}

export async function judgeSectionCitation(input: {
  path: string;
  section: string;
  facts: readonly string[];
  judge: Judge;
  confidence: number;
}): Promise<SectionCitation> {
  const included: string[] = [];
  const withheld: CitationFactRead[] = [];
  for (const fact of input.facts) {
    const text = fact.trim();
    if (text === "") {
      continue;
    }
    if (containsInlineSecret(text)) {
      withheld.push({
        index: 0,
        text,
        verdict: "drop",
        reason: "extracted fact matched a secret pattern",
      });
      continue;
    }
    if (included.length >= CITATION_FACT_MAX) {
      withheld.push({
        index: 0,
        text,
        verdict: "review",
        reason: `more than ${CITATION_FACT_MAX} extracted facts`,
      });
      continue;
    }
    included.push(text);
  }
  if (included.length === 0) {
    return {
      decisions: withheld.map((decision, index) => ({ ...decision, index })),
      calls: 0,
      fellBack: false,
    };
  }
  const state = citationState(input.path, input.section, included);
  assertJevStateSendable(state);
  const result = await input.judge.evaluate({
    state,
    questions: citationQuestions(included.length),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return { decisions: [], calls: 1, fellBack: true };
  }
  const judged = interpretCitation({
    facts: included,
    answers: result.answers,
    confidence: input.confidence,
  });
  return {
    decisions: [
      ...judged,
      ...withheld.map((decision, offset) => ({
        ...decision,
        index: judged.length + offset,
      })),
    ],
    calls: 1,
    fellBack: false,
  };
}

function citationState(path: string, section: string, facts: readonly string[]): {
  path: string;
  section: string;
  facts: Array<{ index: number; text: string }>;
} {
  return {
    path: path.slice(0, JEV_PATH_MAX_CHARS),
    section: section.slice(0, JEV_SECTION_MAX_CHARS),
    facts: facts.map((text, index) => ({
      index,
      text: text.slice(0, CITATION_FACT_TEXT_MAX_CHARS),
    })),
  };
}

export function keptCitationText(decisions: readonly CitationFactRead[]): string | undefined {
  const kept = decisions.filter((decision) => decision.verdict === "keep").map((decision) => decision.text);
  if (kept.length === 0) {
    return undefined;
  }
  return kept.join("\n\n");
}

export function formatCitationLines(input: {
  factId: string;
  decisions: readonly CitationFactRead[];
  dryRun: boolean;
  calls: number;
}): string[] {
  const prefix = input.dryRun ? "[dry-run] " : "";
  const lines = [
    `${prefix}citation ${input.factId}: ${input.calls} Jev call, ${input.decisions.length} extracted fact(s).`,
  ];
  for (const decision of input.decisions) {
    const support =
      decision.support !== undefined && decision.supportConfidence !== undefined
        ? `${decision.support} ${decision.supportConfidence.toFixed(2)}`
        : "support unknown";
    const noul =
      decision.supportedBySource !== undefined && decision.supportedBand !== undefined
        ? `supported_by_source ${decision.supportedBySource.toFixed(2)} ${decision.supportedBand}`
        : "supported_by_source unknown";
    const excerpt = containsInlineSecret(decision.text)
      ? "(fact text redacted)"
      : decision.text.replace(/\s+/g, " ").trim().slice(0, 120);
    lines.push(`${prefix}${decision.verdict} ${support}; ${noul}: ${excerpt}`);
  }
  return lines;
}

function supportedBySourceQuestion(index: number): NoulQuestion {
  return {
    type: "noul",
    instructions: `Does extracted fact ${index} appear in the source section?`,
    criteria: {
      true: "The fact is stated in the source section, or it only restates that section.",
      false: "The fact adds a claim the source section does not contain.",
    },
  };
}

function supportChoice(index: number): ChoiceQuestion {
  return {
    type: "choice",
    instructions: {
      question: `How is extracted fact ${index} supported by the source section?`,
      focus: "Compare only this fact with the source section. High confidence in unsupported means the fact must not be retained.",
    },
    criteria: {
      quoted: {
        what: "The fact restates words that appear in the source section.",
        not_for: "A paraphrase that adds a claim, or a claim the section does not make.",
        examples: [
          "The section says we use Postgres, and the fact says we use Postgres.",
        ],
      },
      implied: {
        what: "The fact follows from the source section without adding a new claim.",
        not_for: "A quote, or a claim the section does not support.",
        examples: [
          "The section says the bank stays on the machine, and the fact says the bank is local.",
        ],
      },
      unsupported: {
        what: "The fact adds a claim the source section does not contain.",
        not_for: "A quote or a direct implication of the section.",
        examples: [
          "The section says we use Postgres, and the fact says we use MySQL.",
        ],
      },
    },
  };
}

function interpretOne(
  index: number,
  text: string,
  answers: Record<string, JudgeAnswer>,
  confidence: number,
): CitationFactRead {
  const supportedBySource = readNoul(answers[`supported_by_source_${index}`]);
  const choice = readChoice(answers[`support_${index}`]);
  const supportedBand =
    supportedBySource === undefined ? undefined : noulBand(supportedBySource, confidence);
  const support = choice !== undefined && isSupport(choice.choice) ? choice.choice : undefined;
  const base = {
    index,
    text,
    ...(support !== undefined ? { support } : {}),
    ...(choice !== undefined ? { supportConfidence: choice.confidence } : {}),
    ...(supportedBySource !== undefined ? { supportedBySource } : {}),
    ...(supportedBand !== undefined ? { supportedBand } : {}),
  };
  const unsupported =
    support === "unsupported" &&
    choice !== undefined &&
    choice.confidence + 1e-9 >= confidence;
  if (unsupported) {
    return { ...base, verdict: "drop", reason: "unsupported" };
  }
  if (supportedBand === "no") {
    return { ...base, verdict: "drop", reason: "not in the source section" };
  }
  const choiceKeeps =
    (support === "quoted" || support === "implied") &&
    choice !== undefined &&
    choice.confidence + 1e-9 >= confidence;
  if (supportedBand === "yes" || choiceKeeps) {
    return {
      ...base,
      verdict: "keep",
      reason: support === "quoted" || support === "implied" ? support : "supported by the source section",
    };
  }
  return {
    ...base,
    verdict: "review",
    reason: `citation confidence below ${confidence.toFixed(2)}`,
  };
}

function isSupport(value: string): value is CitationSupport {
  return (CITATION_SUPPORTS as readonly string[]).includes(value);
}

function readNoul(answer: JudgeAnswer | undefined): number | undefined {
  if (answer === undefined || answer.type !== "noul" || !Number.isFinite(answer.noul)) {
    return undefined;
  }
  return answer.noul;
}

function readChoice(
  answer: JudgeAnswer | undefined,
): { choice: string; confidence: number } | undefined {
  if (
    answer === undefined ||
    answer.type !== "choice" ||
    !Number.isFinite(answer.confidence)
  ) {
    return undefined;
  }
  return { choice: answer.choice, confidence: answer.confidence };
}
