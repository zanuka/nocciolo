/*
Allowlist adoption proposes new durable files for store.allowlist.
Store calls this once per file that the scanner found and the allowlist does
not already contain. One Jev call asks whether the file belongs on the
allowlist (should_adopt) and what kind of knowledge it is (kind, the same
choice used at seed time).

A confident durable kind, with should_adopt at or above the confidence
threshold, is a proposal. A confident no, or a confident noise or style_pref
kind, is not proposed. A mid-range or missing answer stays in review and is
not written. A file that matches a secret pattern is skipped and is not sent
to Jev. The caller prints the list. The allowlist changes only when the
operator passes --apply, and that write does not retain.
*/

import { knowledgeKindById, knowledgeKindQuestion } from "./knowledge-kinds.js";
import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_PATH_MAX_CHARS,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type { Judge, JudgeAnswer, JudgeQuestion, NoulQuestion } from "./types.js";

export type AdoptVerdict = "propose" | "skip" | "review";

export interface AdoptProposal {
  path: string;
  verdict: AdoptVerdict;
  reason: string;
  shouldAdopt?: number;
  shouldAdoptBand?: NoulBand;
  kind?: string;
  kindConfidence?: number;
}

export function adoptQuestions(): Record<string, JudgeQuestion> {
  return {
    should_adopt: shouldAdoptQuestion(),
    kind: knowledgeKindQuestion(),
  };
}

export function interpretAdopt(input: {
  path: string;
  answers: Record<string, JudgeAnswer>;
  confidence: number;
}): AdoptProposal {
  const shouldAdopt = readNoul(input.answers.should_adopt);
  const kind = readChoice(input.answers.kind);
  const shouldAdoptBand =
    shouldAdopt === undefined ? undefined : noulBand(shouldAdopt, input.confidence);
  const spec = kind === undefined ? undefined : knowledgeKindById(kind.choice);
  const kindConfident =
    kind !== undefined && kind.confidence + 1e-9 >= input.confidence;
  const base = {
    path: input.path,
    ...(shouldAdopt !== undefined ? { shouldAdopt } : {}),
    ...(shouldAdoptBand !== undefined ? { shouldAdoptBand } : {}),
    ...(kind !== undefined ? { kind: kind.choice, kindConfidence: kind.confidence } : {}),
  };
  if (kindConfident && spec !== undefined && spec.disposition !== "retain") {
    return {
      ...base,
      verdict: "skip",
      reason: spec.disposition === "personal" ? "personal preference" : "knowledge kind noise",
    };
  }
  if (shouldAdoptBand === "no") {
    return { ...base, verdict: "skip", reason: "not a durable allowlist source" };
  }
  if (
    shouldAdoptBand === "yes" &&
    kindConfident &&
    spec !== undefined &&
    spec.disposition === "retain"
  ) {
    return { ...base, verdict: "propose", reason: spec.id };
  }
  return {
    ...base,
    verdict: "review",
    reason: `allowlist proposal below ${input.confidence.toFixed(2)}`,
  };
}

export async function judgeAllowlistAdoption(input: {
  path: string;
  text: string;
  judge: Judge;
  confidence: number;
}): Promise<AdoptProposal> {
  if (containsInlineSecret(input.path) || containsInlineSecret(input.text)) {
    return {
      path: input.path,
      verdict: "skip",
      reason: "file matched a secret pattern",
    };
  }
  const state = {
    path: input.path.slice(0, JEV_PATH_MAX_CHARS),
    text: input.text.slice(0, JEV_SECTION_MAX_CHARS),
  };
  try {
    assertJevStateSendable(state);
  } catch {
    return {
      path: input.path,
      verdict: "skip",
      reason: "file was not sent to Jev",
    };
  }
  const result = await input.judge.evaluate({
    state,
    questions: adoptQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      path: input.path,
      verdict: "review",
      reason: "allowlist proposal did not return a Jev score",
    };
  }
  return interpretAdopt({
    path: input.path,
    answers: result.answers,
    confidence: input.confidence,
  });
}

export function formatAdoptLines(input: {
  proposals: readonly AdoptProposal[];
  dryRun: boolean;
}): string[] {
  const prefix = input.dryRun ? "[dry-run] " : "";
  if (input.proposals.length === 0) {
    return [`${prefix}No new durable files to propose.`];
  }
  const lines = [`${prefix}Allowlist proposals:`];
  for (const proposal of input.proposals) {
    const noul =
      proposal.shouldAdopt !== undefined && proposal.shouldAdoptBand !== undefined
        ? `should_adopt ${proposal.shouldAdopt.toFixed(2)} ${proposal.shouldAdoptBand}`
        : "should_adopt unknown";
    const kind =
      proposal.kind !== undefined && proposal.kindConfidence !== undefined
        ? `kind ${proposal.kind} ${proposal.kindConfidence.toFixed(2)}`
        : "kind unknown";
    lines.push(`${prefix}${proposal.verdict} ${proposal.path}: ${noul}; ${kind}`);
  }
  return lines;
}

function shouldAdoptQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions: "Is this a durable source Nocciolo should keep in the store allowlist?",
    criteria: {
      true: "An ADR, architecture doc, standard, or other durable project source that belongs on the store allowlist.",
      false: "A dependency readme, scratch notes, generated markdown, or other file that should not join the allowlist.",
    },
  };
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
