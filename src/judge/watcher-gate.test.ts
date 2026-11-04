import { describe, expect, it } from "vitest";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";
import {
  collectSeedEnqueue,
} from "../watcher/enqueue.js";
import {
  HIGH_BEHAVIOR_DELTA_MIN,
  interpretWatcherGate,
  judgeWatcherGate,
  watcherGateQuestions,
} from "./watcher-gate.js";

const PREVIOUS = `# ADR 0001: Local bank

## Decision

We keep the Hindsight bank on the machine. This architecture decision is a project invariant.
`;

const FORMATTING_ONLY = `# ADR 0001: Local bank

## Decision

We keep the Hindsight bank on the machine. This architecture decision is a project invariant.

`;

const CLAIM_CHANGED = `# ADR 0001: Local bank

## Decision

We no longer use Redis. We use SQLite for the local bank. Agents must follow this constraint.
`;

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  claim = 0.05;
  delta = 0;
  deltaConfidence = 0.91;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      model: "jev-1.13.0",
      answers: {
        durable_claim_changed: { type: "noul", noul: this.claim },
        behavior_delta: {
          type: "score",
          score: this.delta,
          legend: { "0": "None", "4": "Must see" },
          probabilities: { "0": 0.1, "4": 0.8 },
          confidence: this.deltaConfidence,
        },
      },
    };
  }
}

describe("watcher high-signal gate", () => {
  it("asks durable_claim_changed and behavior_delta", () => {
    const questions = watcherGateQuestions();
    expect(Object.keys(questions)).toEqual([
      "durable_claim_changed",
      "behavior_delta",
    ]);
    expect(questions.durable_claim_changed?.type).toBe("noul");
    expect(questions.behavior_delta?.type).toBe("score");
    expect(HIGH_BEHAVIOR_DELTA_MIN).toBe(3);
  });

  it("skips a formatting-only save and does not enqueue a seed", async () => {
    const judge = new ScriptedJudge();
    judge.claim = 0.04;
    judge.delta = 0;
    const wordingOnly = PREVIOUS.replace(
      "project invariant.",
      "project invariant!",
    );
    const decision = await judgeWatcherGate({
      path: "docs/adr/0001-local-bank.md",
      previousText: PREVIOUS,
      currentText: wordingOnly,
      judge,
      confidence: 0.8,
    });
    expect(decision.verdict).toBe("skip");
    expect(decision.reason).toBe("durable claim unchanged");
    expect(collectSeedEnqueue([decision])).toBeUndefined();
    expect(judge.calls).toHaveLength(1);
    expect(Object.keys(judge.calls[0]?.questions ?? {})).toEqual([
      "durable_claim_changed",
      "behavior_delta",
    ]);
  });

  it("skips whitespace-only saves before calling Jev", async () => {
    const judge = new ScriptedJudge();
    const decision = await judgeWatcherGate({
      path: "docs/adr/0001-local-bank.md",
      previousText: PREVIOUS,
      currentText: FORMATTING_ONLY,
      judge,
      confidence: 0.8,
    });
    expect(decision.verdict).toBe("skip");
    expect(judge.calls).toHaveLength(0);
    expect(collectSeedEnqueue([decision])).toBeUndefined();
  });

  it("enqueues a real seed when behavior_delta is high", async () => {
    const judge = new ScriptedJudge();
    judge.claim = 0.96;
    judge.delta = 4;
    const decision = await judgeWatcherGate({
      path: "docs/adr/0001-local-bank.md",
      previousText: PREVIOUS,
      currentText: CLAIM_CHANGED,
      judge,
      confidence: 0.8,
    });
    expect(decision.verdict).toBe("enqueue");
    expect(decision.behaviorDelta?.score).toBe(4);
    const enqueue = collectSeedEnqueue([decision]);
    expect(enqueue).toEqual({
      paths: ["docs/adr/0001-local-bank.md"],
      decisions: [decision],
    });
  });

  it("skips without calling Jev when normalized text is identical", async () => {
    const judge = new ScriptedJudge();
    const decision = await judgeWatcherGate({
      path: "docs/adr/0001-local-bank.md",
      previousText: "Keep the bank local.\n\n",
      currentText: "Keep the bank local. ",
      judge,
      confidence: 0.8,
    });
    expect(decision.verdict).toBe("skip");
    expect(judge.calls).toHaveLength(0);
  });

  it("skips a secret file without calling Jev", async () => {
    const judge = new ScriptedJudge();
    const decision = await judgeWatcherGate({
      path: "docs/adr/0001-local-bank.md",
      previousText: PREVIOUS,
      currentText: `${CLAIM_CHANGED}\nsk-test-abcdefghijklmnopqrstuvwxyz\n`,
      judge,
      confidence: 0.8,
    });
    expect(decision.verdict).toBe("skip");
    expect(decision.reason).toMatch(/secret/);
    expect(judge.calls).toHaveLength(0);
  });

  it("interprets a mid-range claim as review", () => {
    const decision = interpretWatcherGate({
      path: "docs/guide.md",
      confidence: 0.8,
      answers: {
        durable_claim_changed: { type: "noul", noul: 0.55 },
        behavior_delta: {
          type: "score",
          score: 2,
          legend: {},
          probabilities: {},
          confidence: 0.5,
        },
      },
    });
    expect(decision.verdict).toBe("review");
  });
});
