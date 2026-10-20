import type {
  ChoiceAnswer,
  ChoiceQuestion,
  Judge,
  JudgeAnswer,
  JudgeEvaluateInput,
  JudgeId,
  JudgeQuestion,
  JudgeResult,
  NoulAnswer,
  ScoreAnswer,
  ScoreQuestion,
} from "./types.js";

function answerNoul(): NoulAnswer {
  return { type: "noul", noul: 0 };
}

function answerChoice(question: ChoiceQuestion): ChoiceAnswer {
  const options = Object.keys(question.criteria);
  const choice = options[0] ?? "unknown";
  const probabilities: Record<string, number> = {};
  for (const option of options) {
    probabilities[option] = option === choice ? 1 : 0;
  }
  if (options.length === 0) {
    probabilities[choice] = 1;
  }
  return {
    type: "choice",
    choice,
    probabilities,
    confidence: 0,
  };
}

function answerScore(question: ScoreQuestion): ScoreAnswer {
  const legend: Record<string, string> = {};
  const probabilities: Record<string, number> = {};
  for (let i = 0; i < question.criteria.length; i += 1) {
    const key = String(i);
    legend[key] = question.criteria[i] ?? "";
    probabilities[key] = i === 0 ? 1 : 0;
  }
  if (question.criteria.length === 0) {
    legend["0"] = "";
    probabilities["0"] = 1;
  }
  return {
    type: "score",
    score: 0,
    legend,
    probabilities,
    confidence: 0,
  };
}

export function heuristicAnswerFor(question: JudgeQuestion): JudgeAnswer {
  switch (question.type) {
    case "noul":
      return answerNoul();
    case "choice":
      return answerChoice(question);
    case "score":
      return answerScore(question);
  }
}

export class HeuristicJudge implements Judge {
  readonly id: JudgeId;

  constructor(id: JudgeId = "heuristic") {
    this.id = id === "off" ? "off" : "heuristic";
  }

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    const answers: Record<string, JudgeAnswer> = {};
    for (const [key, question] of Object.entries(input.questions)) {
      answers[key] = heuristicAnswerFor(question);
    }
    return {
      judgeId: this.id,
      answers,
    };
  }
}
