import { NoccioloError } from "../utils/errors.js";
import type { JudgeAnswer, JudgeQuestion, NoulQuestion, ScoreQuestion } from "./types.js";

const SCORE_MAX = 4;

export interface PriorityWeights {
  durability: number;
  centrality: number;
  supersession: number;
  fanout: number;
  secretRisk: number;
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  durability: 0.4,
  centrality: 0.3,
  supersession: 0.15,
  fanout: 0.15,
  secretRisk: 0.25,
};

export interface PrioritySignals {
  durability?: number;
  centrality?: number;
  supersedesExisting?: number;
  fanout?: number;
  containsSecret?: number;
  containsPii?: number;
}

export interface RankedItem<T> {
  item: T;
  priority: number;
  signals: PrioritySignals;
}

export function priorityQuestions(): Record<string, JudgeQuestion> {
  return {
    centrality: centralityQuestion(),
    supersedes_existing: supersedesExistingQuestion(),
    agent_fanout: fanoutQuestion(),
  };
}

export function parseBudget(value: string): number {
  if (!/^[1-9]\d*$/.test(value.trim())) {
    throw new NoccioloError(
      `Invalid --budget "${value}"`,
      "Pass a positive integer, for example --budget 5.",
    );
  }
  return Number(value);
}

export function assertRetainBudget(budget: number, judgeId: string): void {
  if (!Number.isInteger(budget) || budget < 1) {
    throw new NoccioloError(
      `Invalid --budget "${budget}"`,
      "Pass a positive integer, for example --budget 5.",
    );
  }
  if (judgeId !== "jev") {
    throw new NoccioloError(
      "Retain budget requires --judge jev.",
      "Pass --judge jev, or omit --budget to retain every candidate.",
    );
  }
}

export function resolvePriorityWeights(weights?: PriorityWeights): PriorityWeights {
  return weights ?? DEFAULT_PRIORITY_WEIGHTS;
}

export function readPrioritySignals(
  answers: Record<string, JudgeAnswer>,
): {
  centrality?: { score: number; confidence: number };
  supersedesExisting?: number;
  fanout?: { score: number; confidence: number };
} {
  const centrality = readScore(answers.centrality);
  const fanout = readScore(answers.agent_fanout);
  const supersedesExisting = readNoul(answers.supersedes_existing);
  return {
    ...(centrality !== undefined ? { centrality } : {}),
    ...(fanout !== undefined ? { fanout } : {}),
    ...(supersedesExisting !== undefined ? { supersedesExisting } : {}),
  };
}

export function compositePriority(
  signals: PrioritySignals,
  weights: PriorityWeights,
): number {
  const secret = Math.max(unitNoul(signals.containsSecret), unitNoul(signals.containsPii));
  return (
    weights.durability * unitScore(signals.durability) +
    weights.centrality * unitScore(signals.centrality) +
    weights.supersession * unitNoul(signals.supersedesExisting) +
    weights.fanout * unitScore(signals.fanout) -
    weights.secretRisk * secret
  );
}

export function rankByPriority<T>(
  items: readonly T[],
  signalsFor: (item: T) => PrioritySignals,
  identity: (item: T) => { path: string; id: string },
  weights: PriorityWeights,
): RankedItem<T>[] {
  const ranked = items.map((item) => {
    const signals = signalsFor(item);
    return { item, signals, priority: compositePriority(signals, weights) };
  });
  ranked.sort((left, right) => {
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }
    const leftId = identity(left.item);
    const rightId = identity(right.item);
    const byPath = leftId.path.localeCompare(rightId.path);
    if (byPath !== 0) {
      return byPath;
    }
    return leftId.id.localeCompare(rightId.id);
  });
  return ranked;
}

export interface BudgetLine {
  id: string;
  priority: number;
  signals: PrioritySignals;
}

export function formatBudgetLines(input: {
  ranked: readonly BudgetLine[];
  budget: number;
  weights: PriorityWeights;
  dryRun: boolean;
}): string[] {
  const prefix = input.dryRun ? "[dry-run] " : "";
  const weights = input.weights;
  const lines = [
    `${prefix}Retain budget ${input.budget} (durability=${weights.durability.toFixed(2)} centrality=${weights.centrality.toFixed(2)} supersession=${weights.supersession.toFixed(2)} fanout=${weights.fanout.toFixed(2)} secretRisk=${weights.secretRisk.toFixed(2)}):`,
  ];
  if (input.ranked.length === 0) {
    lines.push(`${prefix}  (no retain candidates)`);
    lines.push(`${prefix}  --- cutoff ---`);
    lines.push(`${prefix}  (none pending)`);
    return lines;
  }
  input.ranked.forEach((row, index) => {
    if (index === input.budget) {
      lines.push(`${prefix}  --- cutoff ---`);
    }
    const pending = index >= input.budget ? " pending" : "";
    lines.push(
      `${prefix}  ${index + 1}. ${row.id}  priority=${row.priority.toFixed(3)}  durability=${fmtScore(row.signals.durability)} centrality=${fmtScore(row.signals.centrality)} supersedes=${fmtNoul(row.signals.supersedesExisting)} fanout=${fmtScore(row.signals.fanout)} secret_risk=${fmtNoul(secretRisk(row.signals))}${pending}`,
    );
  });
  if (input.ranked.length <= input.budget) {
    lines.push(`${prefix}  --- cutoff ---`);
    lines.push(`${prefix}  (none pending)`);
  }
  return lines;
}

function secretRisk(signals: PrioritySignals): number {
  return Math.max(unitNoul(signals.containsSecret), unitNoul(signals.containsPii));
}

function centralityQuestion(): ScoreQuestion {
  return {
    type: "score",
    instructions:
      "How central is this section to the project? 0 is a buried note and 4 is an ADR, AGENTS.md, or constitutional standard.",
    criteria: [
      "Buried note, scratch file, or wording-only changelog",
      "Peripheral note few agents open",
      "Supporting doc, such as a guide section or a reference aside",
      "README, architecture doc, or coding standard",
      "ADR, AGENTS.md, or a constitutional project standard",
    ],
  };
}

function fanoutQuestion(): ScoreQuestion {
  return {
    type: "score",
    instructions:
      "How many agent workflows will recall this section? 0 is none and 4 is shared context for most coding sessions.",
    criteria: [
      "No agent workflow will recall this",
      "One narrow lookup",
      "A few related tasks",
      "Several agent workflows",
      "Shared context most coding sessions will recall",
    ],
  };
}

function supersedesExistingQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions: "Does this section replace a decision already in the bank?",
    criteria: {
      true: "It supersedes an existing decision or standard.",
      false: "It does not replace existing bank knowledge.",
    },
  };
}

function unitScore(score: number | undefined): number {
  if (score === undefined || !Number.isFinite(score)) {
    return 0;
  }
  return Math.min(SCORE_MAX, Math.max(0, score)) / SCORE_MAX;
}

function unitNoul(noul: number | undefined): number {
  if (noul === undefined || !Number.isFinite(noul)) {
    return 0;
  }
  return Math.min(1, Math.max(0, noul));
}

function fmtScore(value: number | undefined): string {
  return value === undefined ? "n/a" : String(value);
}

function fmtNoul(value: number | undefined): string {
  return value === undefined ? "n/a" : value.toFixed(2);
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
