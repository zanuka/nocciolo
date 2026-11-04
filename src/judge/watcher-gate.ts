/*
Watcher high-signal gate decides whether a file change should enqueue a seed.
A future event-driven watcher calls this once per changed durable path with the
previous and current text. One Jev call asks whether the durable claim changed
(durable_claim_changed) and how much agent behavior would change if we skip
re-seed today (behavior_delta, 0 none through 4 agents must see it).

A confident no on the claim is a formatting-only skip and does not enqueue.
A confident yes with a high behavior_delta score at or above the confidence
threshold enqueues a real seed for that path. Mid-range or missing answers
stay in review. A secret match is skipped and is not sent to Jev. This module
does not watch the filesystem and is not wired into the default CLI.
*/

import { noulBand, type NoulBand } from "./relevance.js";
import {
  assertJevStateSendable,
  containsInlineSecret,
  JEV_PATH_MAX_CHARS,
  JEV_SECTION_MAX_CHARS,
} from "./state.js";
import type {
  Judge,
  JudgeAnswer,
  JudgeQuestion,
  NoulQuestion,
  ScoreQuestion,
} from "./types.js";

export const HIGH_BEHAVIOR_DELTA_MIN = 3;

export type WatcherGateVerdict = "enqueue" | "skip" | "review";

export interface WatcherGateDecision {
  path: string;
  verdict: WatcherGateVerdict;
  reason: string;
  durableClaimChanged?: number;
  durableClaimChangedBand?: NoulBand;
  behaviorDelta?: {
    score: number;
    confidence: number;
  };
}

export function watcherGateQuestions(): Record<string, JudgeQuestion> {
  return {
    durable_claim_changed: durableClaimChangedQuestion(),
    behavior_delta: behaviorDeltaQuestion(),
  };
}

export function interpretWatcherGate(input: {
  path: string;
  answers: Record<string, JudgeAnswer>;
  confidence: number;
}): WatcherGateDecision {
  const claim = readNoul(input.answers.durable_claim_changed);
  const delta = readScore(input.answers.behavior_delta);
  const claimBand = claim === undefined ? undefined : noulBand(claim, input.confidence);
  const base = {
    path: input.path,
    ...(claim !== undefined ? { durableClaimChanged: claim } : {}),
    ...(claimBand !== undefined ? { durableClaimChangedBand: claimBand } : {}),
    ...(delta !== undefined ? { behaviorDelta: delta } : {}),
  };

  if (claimBand === "no") {
    return {
      ...base,
      verdict: "skip",
      reason: "durable claim unchanged",
    };
  }

  const deltaConfident =
    delta !== undefined && delta.confidence + 1e-9 >= input.confidence;
  const deltaHigh =
    delta !== undefined && delta.score + 1e-9 >= HIGH_BEHAVIOR_DELTA_MIN;

  if (claimBand === "yes" && deltaConfident && deltaHigh) {
    return {
      ...base,
      verdict: "enqueue",
      reason: "durable claim changed with high behavior delta",
    };
  }

  if (
    claimBand === "yes" &&
    deltaConfident &&
    delta !== undefined &&
    delta.score <= 1 + 1e-9
  ) {
    return {
      ...base,
      verdict: "skip",
      reason: "claim changed but agent behavior would not",
    };
  }

  return {
    ...base,
    verdict: "review",
    reason: `watcher gate below ${input.confidence.toFixed(2)}`,
  };
}

export async function judgeWatcherGate(input: {
  path: string;
  previousText: string;
  currentText: string;
  judge: Judge;
  confidence: number;
}): Promise<WatcherGateDecision> {
  if (
    containsInlineSecret(input.path) ||
    containsInlineSecret(input.previousText) ||
    containsInlineSecret(input.currentText)
  ) {
    return {
      path: input.path,
      verdict: "skip",
      reason: "file matched a secret pattern",
    };
  }

  if (normalizeForCompare(input.previousText) === normalizeForCompare(input.currentText)) {
    return {
      path: input.path,
      verdict: "skip",
      reason: "durable claim unchanged",
    };
  }

  const half = Math.floor(JEV_SECTION_MAX_CHARS / 2);
  const state = {
    path: input.path.slice(0, JEV_PATH_MAX_CHARS),
    previous: input.previousText.slice(0, half),
    current: input.currentText.slice(0, half),
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
    questions: watcherGateQuestions(),
  });
  if (result.fellBackFromJev === true || result.judgeId !== "jev") {
    return {
      path: input.path,
      verdict: "review",
      reason: "watcher gate did not return a Jev score",
    };
  }
  return interpretWatcherGate({
    path: input.path,
    answers: result.answers,
    confidence: input.confidence,
  });
}

export function formatWatcherGateLines(input: {
  decisions: readonly WatcherGateDecision[];
  dryRun: boolean;
}): string[] {
  const prefix = input.dryRun ? "[dry-run] " : "";
  if (input.decisions.length === 0) {
    return [`${prefix}No watcher gate decisions.`];
  }
  const lines = [`${prefix}Watcher high-signal gate:`];
  for (const decision of input.decisions) {
    const claim =
      decision.durableClaimChanged !== undefined &&
      decision.durableClaimChangedBand !== undefined
        ? `durable_claim_changed ${decision.durableClaimChanged.toFixed(2)} ${decision.durableClaimChangedBand}`
        : "durable_claim_changed unknown";
    const delta =
      decision.behaviorDelta !== undefined
        ? `behavior_delta ${decision.behaviorDelta.score} conf ${decision.behaviorDelta.confidence.toFixed(2)}`
        : "behavior_delta unknown";
    lines.push(
      `${prefix}${decision.verdict} ${decision.path}: ${claim}; ${delta}`,
    );
  }
  return lines;
}

function durableClaimChangedQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Did the durable claim in this file change, or is the edit only wording or formatting?",
    criteria: {
      true: "The durable decision, invariant, architecture note, or standard changed.",
      false:
        "Formatting only, a typo fix, whitespace, or other wording that leaves the durable claim the same.",
    },
  };
}

function behaviorDeltaQuestion(): ScoreQuestion {
  return {
    type: "score",
    instructions:
      "How much would agent behavior change if we skip re-seeding this file today? 0 is none and 4 is agents must see the new claim.",
    criteria: [
      "No agent behavior change if we skip re-seed",
      "Negligible wording an agent would not act on",
      "Minor context shift few workflows would notice",
      "Material change agents that recall this path would notice",
      "Constitutional or decision change agents must see on the next turn",
    ],
  };
}

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function readNoul(answer: JudgeAnswer | undefined): number | undefined {
  if (answer === undefined || answer.type !== "noul" || !Number.isFinite(answer.noul)) {
    return undefined;
  }
  return answer.noul;
}

function readScore(
  answer: JudgeAnswer | undefined,
): { score: number; confidence: number } | undefined {
  if (answer === undefined || answer.type !== "score") {
    return undefined;
  }
  if (!Number.isFinite(answer.score) || !Number.isFinite(answer.confidence)) {
    return undefined;
  }
  return { score: answer.score, confidence: answer.confidence };
}
