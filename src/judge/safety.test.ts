import { describe, expect, it } from "vitest";
import { formatSecretSkipWarning, safetyQuestions } from "./safety.js";

describe("safety questions", () => {
  it("asks secret and personal-data nouls where a high score means unsafe", () => {
    const questions = safetyQuestions();
    expect(Object.keys(questions)).toEqual(["contains_secret", "contains_pii"]);
    expect(questions.contains_secret?.criteria?.true).toMatch(/credential|token|key/i);
    expect(questions.contains_pii?.criteria?.true).toMatch(/personal|email|customer/i);
    expect(questions.contains_secret?.criteria?.false).toMatch(/no credential/i);
    expect(questions.contains_pii?.criteria?.false).toMatch(/not private personal data/i);
  });

  it("names the path in the secret warning and does not include a token", () => {
    const secret = "sk-test-abcdefghijklmnopqrstuvwxyz";
    const warning = formatSecretSkipWarning("docs/adr/0001.md");
    expect(warning).toContain("docs/adr/0001.md");
    expect(warning).not.toContain(secret);
    expect(formatSecretSkipWarning(`docs/${secret}.md`)).toBe(
      "Warning: skipped (path redacted): section contains a secret. The secret text was not printed.",
    );
  });
});