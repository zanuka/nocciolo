import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_KIND_IDS,
  knowledgeKindById,
  knowledgeKindQuestion,
  listKnowledgeKinds,
} from "./knowledge-kinds.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("knowledge kind catalog", () => {
  it("keeps the taxonomy bins in a stable order", () => {
    expect(listKnowledgeKinds().map((kind) => kind.id)).toEqual([
      ...KNOWLEDGE_KIND_IDS,
    ]);
  });

  it("stores structured criteria in the data file", () => {
    const question = knowledgeKindQuestion();
    expect(question.type).toBe("choice");
    expect(question.instructions).toMatchObject({
      question: expect.any(String),
      focus: expect.any(String),
    });
    for (const kind of listKnowledgeKinds()) {
      expect(question.criteria[kind.id]).toEqual(kind.criteria);
      expect(kind.criteria.what).not.toBe(kind.criteria.not_for);
      expect(kind.criteria.examples.length).toBeGreaterThanOrEqual(2);
      expect(kind.criteria.not_for.length).toBeGreaterThan(0);
    }
    const whats = listKnowledgeKinds().map((kind) => kind.criteria.what);
    expect(new Set(whats).size).toBe(whats.length);
  });

  it("skips noise and keeps style preferences out of the company bank", () => {
    const noise = knowledgeKindById("noise");
    const style = knowledgeKindById("style_pref");
    expect(noise).toMatchObject({
      companyBank: false,
      disposition: "skip",
      tags: [],
    });
    expect(style).toMatchObject({
      companyBank: false,
      disposition: "personal",
      tags: ["knowledge:style_pref"],
    });
    expect(style?.criteria.not_for).toMatch(/company brain/i);
    expect(noise?.criteria.not_for).toMatch(/skipped/i);
  });

  it("maps each retained kind to stable knowledge tags", () => {
    const tags = Object.fromEntries(
      listKnowledgeKinds().map((kind) => [kind.id, kind.tags]),
    );
    expect(tags).toEqual({
      adr: ["knowledge:adr"],
      invariant: ["knowledge:invariant"],
      public_api: ["knowledge:public_api"],
      architecture: ["knowledge:architecture"],
      standard: ["knowledge:standard"],
      runbook: ["knowledge:runbook"],
      schema: ["knowledge:schema"],
      style_pref: ["knowledge:style_pref"],
      historical_context: ["knowledge:historical_context"],
      opinion: ["knowledge:opinion"],
      noise: [],
    });
    for (const kind of listKnowledgeKinds()) {
      if (kind.disposition === "retain") {
        expect(kind.companyBank).toBe(true);
        expect(kind.tags).toEqual([`knowledge:${kind.id}`]);
      }
    }
  });

  it("does not copy criteria prose into seed, store, or prune", () => {
    const phrase = knowledgeKindById("style_pref")?.criteria.examples[0];
    expect(phrase).toBe("I like a two-space indent in scratch notes.");
    for (const relativePath of [
      "src/commands/seed.ts",
      "src/commands/store.ts",
      "src/commands/prune.ts",
      "src/judge/relevance.ts",
    ]) {
      const source = readFileSync(join(root, relativePath), "utf8");
      expect(source).not.toContain(phrase);
    }
  });
});
