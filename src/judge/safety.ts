import { containsInlineSecret } from "./state.js";
import type { NoulQuestion } from "./types.js";

export function safetyQuestions(): Record<string, NoulQuestion> {
  return {
    contains_secret: {
      type: "noul",
      instructions:
        "Does this section contain a credential, private key, token, or connection string?",
      criteria: {
        true: "A pasted credential, private key, API token, or connection string is present.",
        false: "No credential, private key, token, or connection string is present.",
      },
    },
    contains_pii: {
      type: "noul",
      instructions:
        "Does this section contain a customer name, a personal email address, or other private personal data that should not live in a team bank?",
      criteria: {
        true: "A customer name, personal email address, or other private personal data is present.",
        false:
          "No private personal data is present. A project name or a public maintainer handle is not private personal data.",
      },
    },
  };
}

export function formatSecretSkipWarning(path: string): string {
  const shown = containsInlineSecret(path) ? "(path redacted)" : path;
  return `Warning: skipped ${shown}: section contains a secret. The secret text was not printed.`;
}
