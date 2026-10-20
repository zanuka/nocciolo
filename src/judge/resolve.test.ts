import {
  createJudge,
  DEFAULT_JUDGE_CONFIDENCE,
  meetsConfidence,
  parseConfidence,
  parseJudgeId,
  resolveTypesafeApiKey,
} from "./resolve.js";

describe("parseJudgeId", () => {
  it("defaults to heuristic", () => {
    expect(parseJudgeId(undefined)).toBe("heuristic");
  });

  it("accepts off, heuristic, and jev", () => {
    expect(parseJudgeId("off")).toBe("off");
    expect(parseJudgeId("HEURISTIC")).toBe("heuristic");
    expect(parseJudgeId("jev")).toBe("jev");
  });

  it("rejects unknown ids", () => {
    expect(() => parseJudgeId("cloud")).toThrow(/Unknown judge/);
  });
});

describe("parseConfidence", () => {
  it("defaults to 0.8", () => {
    expect(parseConfidence(undefined)).toBe(DEFAULT_JUDGE_CONFIDENCE);
  });

  it("rejects out-of-range values", () => {
    expect(() => parseConfidence("1.5")).toThrow(/Invalid --confidence/);
  });
});

describe("resolveTypesafeApiKey", () => {
  it("prefers cli over env", () => {
    expect(
      resolveTypesafeApiKey({
        cliKey: "cli-key",
        env: { NOCCIOLO_TYPESAFE_API_KEY: "env-key" },
      }),
    ).toBe("cli-key");
  });

  it("reads NOCCIOLO_TYPESAFE_API_KEY", () => {
    expect(
      resolveTypesafeApiKey({
        env: { NOCCIOLO_TYPESAFE_API_KEY: "env-key" },
      }),
    ).toBe("env-key");
  });

  it("ignores the Hindsight key", () => {
    expect(
      resolveTypesafeApiKey({
        env: { NOCCIOLO_HINDSIGHT_API_KEY: "hindsight-key" },
      }),
    ).toBeUndefined();
  });
});

describe("createJudge", () => {
  it("creates a heuristic judge with no TypeSafe key", () => {
    const resolved = createJudge({
      judge: "heuristic",
      env: {},
    });
    expect(resolved.judgeId).toBe("heuristic");
    expect(resolved.confidence).toBe(0.8);
  });

  it("hard-errors when --judge jev is set without a TypeSafe key", () => {
    expect(() =>
      createJudge({
        judge: "jev",
        env: {},
      }),
    ).toThrow(/Missing NOCCIOLO_TYPESAFE_API_KEY/);
  });

  it("does not call fetch for the default heuristic path", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response("{}", { status: 200 });
    };

    const resolved = createJudge({
      judge: "heuristic",
      env: {},
      fetchImpl,
    });

    const result = await resolved.judge.evaluate({
      state: "section text",
      questions: {
        keep: {
          type: "noul",
          instructions: "Is this durable?",
        },
      },
    });

    expect(called).toBe(false);
    expect(result.answers.keep).toEqual({ type: "noul", noul: 0 });
  });
});

describe("meetsConfidence", () => {
  it("compares choice confidence to the threshold", () => {
    expect(
      meetsConfidence(
        {
          type: "choice",
          choice: "keep",
          probabilities: { keep: 1, skip: 0 },
          confidence: 0.9,
        },
        0.8,
      ),
    ).toBe(true);
    expect(
      meetsConfidence(
        {
          type: "choice",
          choice: "keep",
          probabilities: { keep: 1, skip: 0 },
          confidence: 0.5,
        },
        0.8,
      ),
    ).toBe(false);
  });
});
