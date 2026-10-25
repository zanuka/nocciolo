import rawCatalog from "./knowledge-kinds.json";
import { NoccioloError } from "../utils/errors.js";
import type { ChoiceQuestion } from "./types.js";

export const KNOWLEDGE_KIND_IDS = [
  "adr",
  "invariant",
  "public_api",
  "architecture",
  "standard",
  "runbook",
  "schema",
  "style_pref",
  "historical_context",
  "opinion",
  "noise",
] as const;

export type KnowledgeKindId = (typeof KNOWLEDGE_KIND_IDS)[number];

export type KnowledgeKindDisposition = "retain" | "skip" | "personal";

export interface KnowledgeKindCriterion {
  what: string;
  not_for: string;
  examples: string[];
}

export interface KnowledgeKindSpec {
  id: KnowledgeKindId;
  companyBank: boolean;
  disposition: KnowledgeKindDisposition;
  tags: string[];
  criteria: KnowledgeKindCriterion;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(detail: string): never {
  throw new NoccioloError(
    `Knowledge-kind catalog is invalid: ${detail}`,
    "Fix src/judge/knowledge-kinds.json. Each kind needs what, not_for, and examples.",
  );
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function parseCatalog(value: unknown): {
  instructions: { question: string; focus: string };
  kinds: KnowledgeKindSpec[];
} {
  if (!isRecord(value)) {
    fail("catalog must be an object");
  }
  if (!isRecord(value.instructions)) {
    fail("instructions must be an object");
  }
  const instructions = {
    question: readString(value.instructions.question, "instructions.question"),
    focus: readString(value.instructions.focus, "instructions.focus"),
  };
  if (!Array.isArray(value.kinds)) {
    fail("kinds must be an array");
  }
  if (value.kinds.length !== KNOWLEDGE_KIND_IDS.length) {
    fail(`expected ${KNOWLEDGE_KIND_IDS.length} kinds`);
  }

  const kinds: KnowledgeKindSpec[] = [];
  for (const [index, entry] of value.kinds.entries()) {
    const expected = KNOWLEDGE_KIND_IDS[index];
    if (!isRecord(entry) || expected === undefined) {
      fail(`kinds[${index}] must be an object`);
    }
    const id = readString(entry.id, `kinds[${index}].id`);
    if (id !== expected) {
      fail(`kinds[${index}].id must be "${expected}"`);
    }
    if (typeof entry.company_bank !== "boolean") {
      fail(`${id}.company_bank must be a boolean`);
    }
    const companyBank = entry.company_bank;
    const dispositionRaw = readString(entry.disposition, `${id}.disposition`);
    if (
      dispositionRaw !== "retain" &&
      dispositionRaw !== "skip" &&
      dispositionRaw !== "personal"
    ) {
      fail(`${id}.disposition must be retain, skip, or personal`);
    }
    const disposition: KnowledgeKindDisposition = dispositionRaw;
    if (!Array.isArray(entry.tags)) {
      fail(`${id}.tags must be an array`);
    }
    const tags = entry.tags.map((tag, tagIndex) =>
      readString(tag, `${id}.tags[${tagIndex}]`),
    );
    if (!isRecord(entry.criteria)) {
      fail(`${id}.criteria must be an object`);
    }
    const what = readString(entry.criteria.what, `${id}.criteria.what`);
    const notFor = readString(entry.criteria.not_for, `${id}.criteria.not_for`);
    if (what === notFor) {
      fail(`${id}.criteria.not_for must differ from what`);
    }
    if (!Array.isArray(entry.criteria.examples) || entry.criteria.examples.length < 2) {
      fail(`${id}.criteria.examples needs at least two strings`);
    }
    const examples = entry.criteria.examples.map((example, exampleIndex) =>
      readString(example, `${id}.criteria.examples[${exampleIndex}]`),
    );
    if (companyBank !== (disposition === "retain")) {
      fail(`${id}.company_bank must be true only when disposition is retain`);
    }
    if (disposition === "retain" && tags.length === 0) {
      fail(`${id} needs at least one retain tag`);
    }
    if (disposition === "skip" && tags.length !== 0) {
      fail(`${id} is skipped and must not define retain tags`);
    }
    if (disposition === "personal" && tags.length === 0) {
      fail(`${id} needs tags for a later personal store`);
    }
    kinds.push({
      id: expected,
      companyBank,
      disposition,
      tags,
      criteria: { what, not_for: notFor, examples },
    });
  }

  return { instructions, kinds };
}

const catalog = parseCatalog(rawCatalog);

const byId = new Map(catalog.kinds.map((kind) => [kind.id, kind]));

export function listKnowledgeKinds(): readonly KnowledgeKindSpec[] {
  return catalog.kinds;
}

export function knowledgeKindById(id: string): KnowledgeKindSpec | undefined {
  return byId.get(id as KnowledgeKindId);
}

export function knowledgeKindQuestion(): ChoiceQuestion {
  const criteria: ChoiceQuestion["criteria"] = {};
  for (const kind of catalog.kinds) {
    criteria[kind.id] = {
      what: kind.criteria.what,
      not_for: kind.criteria.not_for,
      examples: [...kind.criteria.examples],
    };
  }
  return {
    type: "choice",
    instructions: {
      question: catalog.instructions.question,
      focus: catalog.instructions.focus,
    },
    criteria,
  };
}
