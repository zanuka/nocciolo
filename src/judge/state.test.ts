import { JevJudge } from "./jev.js";
import {
  JEV_CHARS_PER_TOKEN,
  JEV_OVERLAP_MAX,
  JEV_SECTION_MAX_CHARS,
  JEV_STATE_MAX_CHARS,
  JEV_STATE_MAX_TOKENS,
  JEV_STATE_QUESTION_TOKEN_BUDGET,
  buildJevState,
  emitJevDispatchLogs,
  fitJevState,
  jevDispatchLogs,
} from "./state.js";

const FAKE_API_KEY = "sk-test-abcdefghijklmnopqrstuvwxyz";

describe("buildJevState", () => {
  it("skips a seedable doc that contains a fake API key", () => {
    const sectionText = [
      "# Use Hindsight locally",
      "",
      "The bank stays on this machine.",
      "",
      `Example token: ${FAKE_API_KEY}`,
    ].join("\n");

    const result = buildJevState({
      path: "docs/adr/0001-local-bank.md",
      heading: "Use Hindsight locally",
      sectionText,
      mission: "Keep durable knowledge on the machine.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("inline-secret");
    expect(result.path).toBe("docs/adr/0001-local-bank.md");
    expect(result.message).toContain("docs/adr/0001-local-bank.md");
    expect(result.message).not.toContain(FAKE_API_KEY);
    expect(JSON.stringify(result)).not.toContain(FAKE_API_KEY);
  });

  it("skips a private key and a credential connection string", () => {
    const pem = buildJevState({
      path: "docs/adr/0002-keys.md",
      sectionText: "-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----",
    });
    const connection = buildJevState({
      path: "docs/adr/0003-db.md",
      sectionText: "postgres://app:secretpass@localhost/nocciolo",
    });

    expect(pem.ok).toBe(false);
    expect(connection.ok).toBe(false);
    if (!pem.ok && !connection.ok) {
      expect(pem.reason).toBe("inline-secret");
      expect(connection.reason).toBe("inline-secret");
      expect(JSON.stringify(pem)).not.toContain("PRIVATE KEY");
      expect(JSON.stringify(connection)).not.toContain("secretpass");
    }
  });

  it("skips a denylisted path without copying file text", () => {
    const result = buildJevState({
      path: "docs/credentials.md",
      sectionText: `token ${FAKE_API_KEY}`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("denylist");
    expect(result.message).toContain("docs/credentials.md");
    expect(JSON.stringify(result)).not.toContain(FAKE_API_KEY);
  });

  it("redacts a path that itself matches a secret pattern", () => {
    const result = buildJevState({
      path: `docs/${FAKE_API_KEY}.md`,
      sectionText: "Prefer durable knowledge.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("inline-secret");
    expect(JSON.stringify(result)).not.toContain(FAKE_API_KEY);
    expect(result.message).toContain("[redacted]");
  });

  it("keeps a durable section that only discusses secrets", () => {
    const result = buildJevState({
      path: "docs/adr/0004-policy.md",
      heading: "Secrets stay local",
      sectionText:
        "API keys stay in the environment. Do not retain passwords or tokens.",
      mission: "Prefer durable knowledge.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.path).toBe("docs/adr/0004-policy.md");
    expect(result.state.heading).toBe("Secrets stay local");
    expect(result.state.section).toContain("API keys stay");
    expect(result.state.mission).toBe("Prefer durable knowledge.");
  });

  it("caps section text, mission, and overlap count", () => {
    const overlaps = Array.from({ length: JEV_OVERLAP_MAX + 3 }, (_, index) => ({
      summary: `overlap ${index} ${"x".repeat(JEV_SECTION_MAX_CHARS)}`,
      documentId: `doc-${index}`,
    }));
    const result = buildJevState({
      path: "docs/adr/0005-long.md",
      heading: "H",
      sectionText: "s".repeat(JEV_SECTION_MAX_CHARS + 500),
      mission: "m".repeat(5_000),
      overlaps,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.section.length).toBeLessThanOrEqual(JEV_SECTION_MAX_CHARS);
    expect(result.state.section.endsWith("\n[truncated]")).toBe(true);
    expect(result.state.mission?.endsWith("\n[truncated]")).toBe(true);
    expect(result.state.overlaps).toHaveLength(JEV_OVERLAP_MAX);
    expect(JSON.stringify(result.state).length).toBeLessThanOrEqual(
      JEV_STATE_MAX_CHARS,
    );
    expect(JSON.stringify(result.state)).not.toContain(FAKE_API_KEY);
  });

  it("aligns the hard cap with the 32k state and question budget", () => {
    expect(JEV_STATE_QUESTION_TOKEN_BUDGET).toBe(32_000);
    expect(JEV_STATE_MAX_TOKENS).toBeLessThan(JEV_STATE_QUESTION_TOKEN_BUDGET);
    expect(JEV_STATE_MAX_CHARS).toBe(JEV_STATE_MAX_TOKENS * JEV_CHARS_PER_TOKEN);

    const fitted = fitJevState(
      {
        path: "docs/adr/0006.md",
        section: "z".repeat(10_000),
        mission: "mission text that should drop first",
        overlaps: [{ summary: "overlap" }],
      },
      80,
    );
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(80);
    expect(fitted.mission).toBeUndefined();
    expect(fitted.overlaps).toBeUndefined();
  });

  it("does not put a skipped key on the TypeSafe request body", async () => {
    const built = buildJevState({
      path: "docs/adr/0001-local-bank.md",
      heading: "Decision",
      sectionText: `Keep the bank local.\n\n${FAKE_API_KEY}`,
    });
    expect(built.ok).toBe(false);

    let called = false;
    const judge = new JevJudge({
      apiKey: "test-key",
      log: () => undefined,
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });

    await expect(
      judge.evaluate({
        state: {
          path: "docs/adr/0001-local-bank.md",
          section: `Keep the bank local.\n\n${FAKE_API_KEY}`,
        },
        questions: {
          keep: { type: "noul", instructions: "Keep?" },
        },
      }),
    ).rejects.toThrow(/secret pattern/);
    expect(called).toBe(false);
  });
});

describe("jevDispatchLogs", () => {
  it("logs path and question ids at info and lengths at debug", () => {
    const section = "Prefer durable knowledge UNIQUE_MARKER";
    const logs = jevDispatchLogs({
      questionIds: ["keep", "durable"],
      state: {
        path: "docs/adr/0004-policy.md",
        heading: "Secrets stay local",
        section,
      },
    });
    const lines: string[] = [];
    emitJevDispatchLogs(
      logs,
      (_level, message) => lines.push(message),
      {},
    );

    expect(lines).toEqual([
      "jev judge path=docs/adr/0004-policy.md questions=keep,durable",
    ]);
    expect(lines.join("\n")).not.toContain("UNIQUE_MARKER");

    const debugLines: string[] = [];
    emitJevDispatchLogs(
      logs,
      (level, message) => debugLines.push(`${level}:${message}`),
      { NOCCIOLO_LOG_LEVEL: "debug" },
    );
    expect(debugLines[0]).toContain("questions=keep,durable");
    expect(debugLines[1]).toContain("fields=path,heading,section");
    expect(debugLines[1]).toContain(`section:${section.length}`);
    expect(debugLines.join("\n")).not.toContain("UNIQUE_MARKER");
  });
});
