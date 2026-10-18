export type JudgeId = "off" | "heuristic" | "jev";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Instructions = string | JsonValue;

export interface NoulQuestion {
  type: "noul";
  instructions: Instructions;
  criteria?: {
    true?: string;
    false?: string;
  };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: Instructions;
  criteria: Record<string, string | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: Instructions;
  criteria: string[];
}

export type JudgeQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type JudgeAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface JudgeEvaluateInput {
  state: unknown;
  questions: Record<string, JudgeQuestion>;
  model?: string;
}

export interface JudgeResult {
  judgeId: JudgeId;
  model?: string;
  answers: Record<string, JudgeAnswer>;
  fellBackFromJev?: boolean;
}

export interface Judge {
  readonly id: JudgeId;
  evaluate(input: JudgeEvaluateInput): Promise<JudgeResult>;
}
