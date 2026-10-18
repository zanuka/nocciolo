import { createJudge } from "./resolve.js";
import { JevJudge } from "./jev.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("JevJudge", () => {
  it("posts to /v1/systemone and maps typed answers", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });
      return jsonResponse({
        model: "jev-1.13.0",
        answers: {
          keep: {
            type: "choice",
            choice: "keep",
            probabilities: { keep: 0.9, skip: 0.1 },
            confidence: 0.85,
          },
          durable: {
            type: "noul",
            noul: 0.92,
          },
          quality: {
            type: "score",
            score: 1.1,
            legend: { "0": "low", "1": "mid", "2": "high" },
            probabilities: { "0": 0, "1": 0.9, "2": 0.1 },
            confidence: 0.88,
          },
        },
      });
    };

    const judge = new JevJudge({
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await judge.evaluate({
      state: { section: "Prefer durable knowledge" },
      questions: {
        keep: {
          type: "choice",
          instructions: "Keep or skip?",
          criteria: { keep: "durable", skip: "noise" },
        },
        durable: {
          type: "noul",
          instructions: "Is this durable?",
        },
        quality: {
          type: "score",
          instructions: "How strong is this section?",
          criteria: ["low", "mid", "high"],
        },
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(calls[0]?.body).toMatchObject({
      model: "jev-latest",
      state: { section: "Prefer durable knowledge" },
    });
    expect(result.judgeId).toBe("jev");
    expect(result.model).toBe("jev-1.13.0");
    expect(result.answers.keep).toEqual({
      type: "choice",
      choice: "keep",
      probabilities: { keep: 0.9, skip: 0.1 },
      confidence: 0.85,
    });
    expect(result.answers.durable).toEqual({ type: "noul", noul: 0.92 });
    expect(result.answers.quality?.type).toBe("score");
  });

  it("falls back to heuristics on 429 unless --strict", async () => {
    const warnings: string[] = [];
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ error: "rate limited" }, 429);
    };

    const resolved = createJudge({
      judge: "jev",
      env: { NOCCIOLO_TYPESAFE_API_KEY: "test-key" },
      fetchImpl,
      warn: (message) => warnings.push(message),
    });

    const result = await resolved.judge.evaluate({
      state: "section",
      questions: {
        keep: {
          type: "choice",
          instructions: "Keep?",
          criteria: { keep: null, skip: null },
        },
      },
    });

    expect(calls).toBe(1);
    expect(result.fellBackFromJev).toBe(true);
    expect(result.answers.keep).toMatchObject({
      type: "choice",
      choice: "keep",
      confidence: 0,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/falling back to offline heuristics/);
  });

  it("fails on 429 when --strict is set", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ error: "rate limited" }, 429);

    const resolved = createJudge({
      judge: "jev",
      strict: true,
      env: { NOCCIOLO_TYPESAFE_API_KEY: "test-key" },
      fetchImpl,
    });

    await expect(
      resolved.judge.evaluate({
        state: "section",
        questions: {
          keep: {
            type: "noul",
            instructions: "Keep?",
          },
        },
      }),
    ).rejects.toThrow(/TypeSafe API error 429/);
  });

  it("falls back to heuristics on timeout", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          reject(new Error("missing signal"));
          return;
        }
        if (signal.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
          return;
        }
        signal.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    };

    const resolved = createJudge({
      judge: "jev",
      env: { NOCCIOLO_TYPESAFE_API_KEY: "test-key" },
      fetchImpl,
      timeoutMs: 10,
      warn: () => undefined,
    });

    const result = await resolved.judge.evaluate({
      state: "section",
      questions: {
        keep: {
          type: "noul",
          instructions: "Keep?",
        },
      },
    });

    expect(result.fellBackFromJev).toBe(true);
    expect(result.answers.keep).toEqual({ type: "noul", noul: 0 });
  });
});
