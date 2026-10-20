import type { Command } from "commander";
import { DEFAULT_JUDGE_CONFIDENCE } from "./resolve.js";

export const JUDGE_OPTION_HELP =
  "Decision judge: off, heuristic (default), or jev (hosted TypeSafe, optional; requires NOCCIOLO_TYPESAFE_API_KEY)";

export const CONFIDENCE_OPTION_HELP = `Minimum confidence to apply a Jev decision (0-1, default ${DEFAULT_JUDGE_CONFIDENCE}; see docs/jev.md)`;

export const STRICT_OPTION_HELP =
  "With --judge jev, fail on TypeSafe network/API errors instead of falling back to offline heuristics";

export interface JudgeCliOptions {
  judge?: string;
  confidence?: number;
  strict?: boolean;
}

export function addJudgeCliOptions(command: Command): Command {
  return command
    .option("--judge <id>", JUDGE_OPTION_HELP)
    .option("--confidence <n>", CONFIDENCE_OPTION_HELP)
    .option("--strict", STRICT_OPTION_HELP);
}

export function judgeOptionsFromCli(opts: {
  judge?: string;
  confidence?: string;
  strict?: boolean;
}): JudgeCliOptions {
  const out: JudgeCliOptions = {
    strict: Boolean(opts.strict),
  };
  if (opts.judge !== undefined) {
    out.judge = opts.judge;
  }
  if (opts.confidence !== undefined) {
    out.confidence = Number(opts.confidence);
  }
  return out;
}
