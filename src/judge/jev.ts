import { NoccioloError } from "../utils/errors.js";
import {
  assertJevStateSendable,
  emitJevDispatchLogs,
  jevDispatchLogs,
  type JevLogLevel,
} from "./state.js";
import type {
  ChoiceAnswer,
  Judge,
  JudgeAnswer,
  JudgeEvaluateInput,
  JudgeQuestion,
  JudgeResult,
  NoulAnswer,
  ScoreAnswer,
} from "./types.js";

export const DEFAULT_TYPESAFE_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_JEV_MODEL = "jev-latest";
export const DEFAULT_JEV_TIMEOUT_MS = 30_000;

export interface JevJudgeOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  log?: (level: JevLogLevel, message: string) => void;
}

interface SystemOneResponseBody {
  model?: string;
  answers?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNoulAnswer(value: Record<string, unknown>): NoulAnswer {
  if (typeof value.noul !== "number") {
    throw new NoccioloError(
      "TypeSafe returned an invalid noul answer",
      "Retry with --judge heuristic, or report a bug if this persists.",
    );
  }
  return { type: "noul", noul: value.noul };
}

function parseChoiceAnswer(value: Record<string, unknown>): ChoiceAnswer {
  if (
    typeof value.choice !== "string" ||
    !isRecord(value.probabilities) ||
    typeof value.confidence !== "number"
  ) {
    throw new NoccioloError(
      "TypeSafe returned an invalid choice answer",
      "Retry with --judge heuristic, or report a bug if this persists.",
    );
  }
  const probabilities: Record<string, number> = {};
  for (const [key, prob] of Object.entries(value.probabilities)) {
    if (typeof prob !== "number") {
      throw new NoccioloError(
        "TypeSafe returned an invalid choice answer",
        "Retry with --judge heuristic, or report a bug if this persists.",
      );
    }
    probabilities[key] = prob;
  }
  return {
    type: "choice",
    choice: value.choice,
    probabilities,
    confidence: value.confidence,
  };
}

function parseScoreAnswer(value: Record<string, unknown>): ScoreAnswer {
  if (
    typeof value.score !== "number" ||
    !isRecord(value.legend) ||
    !isRecord(value.probabilities) ||
    typeof value.confidence !== "number"
  ) {
    throw new NoccioloError(
      "TypeSafe returned an invalid score answer",
      "Retry with --judge heuristic, or report a bug if this persists.",
    );
  }
  const legend: Record<string, string> = {};
  for (const [key, label] of Object.entries(value.legend)) {
    if (typeof label !== "string") {
      throw new NoccioloError(
        "TypeSafe returned an invalid score answer",
        "Retry with --judge heuristic, or report a bug if this persists.",
      );
    }
    legend[key] = label;
  }
  const probabilities: Record<string, number> = {};
  for (const [key, prob] of Object.entries(value.probabilities)) {
    if (typeof prob !== "number") {
      throw new NoccioloError(
        "TypeSafe returned an invalid score answer",
        "Retry with --judge heuristic, or report a bug if this persists.",
      );
    }
    probabilities[key] = prob;
  }
  return {
    type: "score",
    score: value.score,
    legend,
    probabilities,
    confidence: value.confidence,
  };
}

function parseAnswer(value: unknown): JudgeAnswer {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new NoccioloError(
      "TypeSafe returned an invalid answer",
      "Retry with --judge heuristic, or report a bug if this persists.",
    );
  }
  switch (value.type) {
    case "noul":
      return parseNoulAnswer(value);
    case "choice":
      return parseChoiceAnswer(value);
    case "score":
      return parseScoreAnswer(value);
    default:
      throw new NoccioloError(
        `TypeSafe returned unsupported answer type "${value.type}"`,
        "Retry with --judge heuristic, or report a bug if this persists.",
      );
  }
}

function toRequestQuestion(question: JudgeQuestion): Record<string, unknown> {
  switch (question.type) {
    case "noul": {
      const body: Record<string, unknown> = {
        type: "noul",
        instructions: question.instructions,
      };
      if (question.criteria !== undefined) {
        body.criteria = question.criteria;
      }
      return body;
    }
    case "choice":
      return {
        type: "choice",
        instructions: question.instructions,
        criteria: question.criteria,
      };
    case "score":
      return {
        type: "score",
        instructions: question.instructions,
        criteria: question.criteria,
      };
  }
}

export function isJevTransientError(error: unknown): boolean {
  if (error instanceof NoccioloError) {
    const status = error.statusCode;
    return (
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      status === 529 ||
      (status === undefined &&
        /timed?\s*out|timeout|network|fetch failed|ECONNRESET|ENOTFOUND|ECONNREFUSED/i.test(
          error.message,
        ))
    );
  }
  if (error instanceof Error) {
    return /timed?\s*out|timeout|network|fetch failed|AbortError|ECONNRESET|ENOTFOUND|ECONNREFUSED/i.test(
      error.message,
    );
  }
  return false;
}

export class JevJudge implements Judge {
  readonly id = "jev" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log: (level: JevLogLevel, message: string) => void;

  constructor(options: JevJudgeOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_TYPESAFE_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.model = options.model ?? DEFAULT_JEV_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.log =
      options.log ??
      ((level, message) => {
        if (level === "debug") {
          console.debug(message);
          return;
        }
        console.info(message);
      });
  }

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    assertJevStateSendable(input.state);
    emitJevDispatchLogs(
      jevDispatchLogs({
        questionIds: Object.keys(input.questions),
        state: input.state,
      }),
      this.log,
    );

    const questions: Record<string, unknown> = {};
    for (const [key, question] of Object.entries(input.questions)) {
      questions[key] = toRequestQuestion(question);
    }

    const url = `${this.baseUrl}/v1/systemone`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          state: input.state,
          model: input.model ?? this.model,
          questions,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new NoccioloError(
          `TypeSafe request timed out after ${this.timeoutMs}ms`,
          "Retry later, or omit --judge jev to keep offline heuristics.",
        );
      }
      throw new NoccioloError(
        `TypeSafe request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Check network access to api.typesafe.ai, or omit --judge jev to keep offline heuristics.",
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new NoccioloError(
        `TypeSafe API error ${response.status}`,
        text.trim() ||
          "Retry later, or omit --judge jev to keep offline heuristics.",
        response.status,
      );
    }

    let body: SystemOneResponseBody;
    try {
      body = JSON.parse(text) as SystemOneResponseBody;
    } catch {
      throw new NoccioloError(
        "TypeSafe returned non-JSON",
        "Retry with --judge heuristic, or report a bug if this persists.",
      );
    }

    if (!isRecord(body.answers)) {
      throw new NoccioloError(
        "TypeSafe response missing answers",
        "Retry with --judge heuristic, or report a bug if this persists.",
      );
    }

    const answers: Record<string, JudgeAnswer> = {};
    for (const key of Object.keys(input.questions)) {
      if (!(key in body.answers)) {
        throw new NoccioloError(
          `TypeSafe response missing answer for "${key}"`,
          "Retry with --judge heuristic, or report a bug if this persists.",
        );
      }
      answers[key] = parseAnswer(body.answers[key]);
    }

    return {
      judgeId: "jev",
      ...(body.model !== undefined ? { model: body.model } : {}),
      answers,
    };
  }
}
