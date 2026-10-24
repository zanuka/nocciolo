import { NoccioloError } from "../utils/errors.js";
import { HeuristicJudge } from "./heuristic.js";
import { isJevTransientError, JevJudge } from "./jev.js";
import type { JevLogLevel } from "./state.js";
import type {
  ChoiceAnswer,
  Judge,
  JudgeEvaluateInput,
  JudgeId,
  JudgeResult,
  ScoreAnswer,
} from "./types.js";

export const DEFAULT_JUDGE_CONFIDENCE = 0.8;

export interface ResolveJudgeOptions {
  judge?: string;
  confidence?: number | string;
  strict?: boolean;
  apiKey?: string;
  env?: NodeJS.ProcessEnv;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  warn?: (message: string) => void;
  log?: (level: JevLogLevel, message: string) => void;
}

export interface ResolvedJudge {
  judgeId: JudgeId;
  confidence: number;
  strict: boolean;
  judge: Judge;
}

export function parseJudgeId(value: string | undefined): JudgeId {
  const id = (value ?? "heuristic").trim().toLowerCase();
  if (id === "off" || id === "heuristic" || id === "jev") {
    return id;
  }
  throw new NoccioloError(
    `Unknown judge "${value}"`,
    "Use --judge off, --judge heuristic, or --judge jev (hosted TypeSafe, optional).",
  );
}

export function parseConfidence(
  value: number | string | undefined,
): number {
  if (value === undefined) {
    return DEFAULT_JUDGE_CONFIDENCE;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new NoccioloError(
      `Invalid --confidence "${value}"`,
      "Pass a number between 0 and 1 (default 0.8). See docs/jev.md.",
    );
  }
  return n;
}

export function resolveTypesafeApiKey(input: {
  cliKey?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string | undefined {
  const env = input.env ?? process.env;
  const cli = input.cliKey?.trim();
  if (cli) {
    return cli;
  }
  const fromEnv = env.NOCCIOLO_TYPESAFE_API_KEY?.trim();
  return fromEnv || undefined;
}

export function meetsConfidence(
  answer: ChoiceAnswer | ScoreAnswer,
  threshold: number,
): boolean {
  return answer.confidence >= threshold;
}

class FallbackJevJudge implements Judge {
  readonly id = "jev" as const;
  private readonly primary: JevJudge;
  private readonly fallback: HeuristicJudge;
  private readonly strict: boolean;
  private readonly warn: (message: string) => void;
  private warned = false;

  constructor(input: {
    primary: JevJudge;
    fallback: HeuristicJudge;
    strict: boolean;
    warn: (message: string) => void;
  }) {
    this.primary = input.primary;
    this.fallback = input.fallback;
    this.strict = input.strict;
    this.warn = input.warn;
  }

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    try {
      return await this.primary.evaluate(input);
    } catch (error) {
      if (this.strict || !isJevTransientError(error)) {
        throw error;
      }
      if (!this.warned) {
        const detail =
          error instanceof Error ? error.message : String(error);
        this.warn(
          `TypeSafe judge unavailable (${detail}); falling back to offline heuristics for this run. Pass --strict to fail instead.`,
        );
        this.warned = true;
      }
      const result = await this.fallback.evaluate(input);
      return {
        ...result,
        judgeId: "jev",
        fellBackFromJev: true,
      };
    }
  }
}

export function createJudge(options: ResolveJudgeOptions = {}): ResolvedJudge {
  const judgeId = parseJudgeId(options.judge);
  const confidence = parseConfidence(options.confidence);
  const strict = options.strict ?? false;
  const warn = options.warn ?? ((message: string) => console.warn(message));

  if (judgeId === "off" || judgeId === "heuristic") {
    return {
      judgeId,
      confidence,
      strict,
      judge: new HeuristicJudge(judgeId),
    };
  }

  const apiKey = resolveTypesafeApiKey({
    ...(options.apiKey !== undefined ? { cliKey: options.apiKey } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
  });

  if (!apiKey) {
    throw new NoccioloError(
      "Missing NOCCIOLO_TYPESAFE_API_KEY for --judge jev",
      "Set NOCCIOLO_TYPESAFE_API_KEY, or omit --judge jev to keep offline heuristics.",
    );
  }

  const primary = new JevJudge({
    apiKey,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options.fetchImpl !== undefined
      ? { fetchImpl: options.fetchImpl }
      : {}),
    ...(options.log !== undefined ? { log: options.log } : {}),
  });

  return {
    judgeId,
    confidence,
    strict,
    judge: new FallbackJevJudge({
      primary,
      fallback: new HeuristicJudge("heuristic"),
      strict,
      warn,
    }),
  };
}
