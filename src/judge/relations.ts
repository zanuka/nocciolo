import type { ObservationLink } from "../extractor/types.js";
import type { JevOverlap } from "./state.js";
import type { ChoiceQuestion, JudgeAnswer, NoulQuestion } from "./types.js";

export const OBSERVATION_RELATIONS = [
  "supports",
  "extends",
  "supersedes",
  "contradicts",
  "unrelated",
] as const;

export type ObservationRelation = (typeof OBSERVATION_RELATIONS)[number];

export const RELATION_CHOICE_MAX_OVERLAPS = 3;

const RELATION_CRITERIA: Record<
  ObservationRelation,
  { what: string; not_for: string; examples: string[] }
> = {
  supports: {
    what: "The section agrees with the observation and does not replace it.",
    not_for: "A section that replaces the observation or talks about a different topic.",
    examples: [
      "The observation says the bank stays local, and the section repeats that the bank stays on the machine.",
      "Both say agents should prefer durable docs over chat history.",
    ],
  },
  extends: {
    what: "The section adds a compatible detail without replacing the observation.",
    not_for: "A section that conflicts with the observation or is about something else.",
    examples: [
      "The observation says the bank stays local, and the section adds that Docker is the default host.",
      "The observation names Hindsight, and the section adds the retain mission wording.",
    ],
  },
  supersedes: {
    what: "The section replaces the observation as the current fact. The old claim should not stay current beside it.",
    not_for: "A section that agrees, merely adds detail, or discusses a different topic.",
    examples: [
      "The observation says we use MySQL, and ADR-0008 says we use Postgres.",
      "The observation says sessions are the source of truth, and the section says durable docs are.",
    ],
  },
  contradicts: {
    what: "The section conflicts with the observation and both cannot be current, without clearly retiring the old claim.",
    not_for: "A section that agrees, extends, or replaces the observation as the new current fact.",
    examples: [
      "The observation says we use MySQL, and the section says we use Postgres without retiring the old choice.",
      "The observation says the CLI is cloud-first, and the section says the CLI is local-first.",
    ],
  },
  unrelated: {
    what: "The observation is about a different topic than the section.",
    not_for: "A section that supports, extends, replaces, or conflicts with the observation.",
    examples: [
      "The observation is about Postgres, and the section is about markdown heading parsing.",
      "The observation names a coding standard, and the section is a changelog.",
    ],
  },
};

export interface ObservationRelationRead {
  choice: ObservationRelation;
  confidence: number;
  probabilities: Record<string, number>;
  observationIds: string[];
}

export interface ObservationConflictRead {
  observationId: string;
  noul: number;
  band: "yes" | "no" | "uncertain";
}

export interface InterpretedRelation {
  relation?: ObservationRelationRead;
  conflicts?: ObservationConflictRead[];
  observationLinks?: ObservationLink[];
}

export function linkableOverlaps(
  overlaps: readonly JevOverlap[],
): Array<JevOverlap & { id: string }> {
  const out: Array<JevOverlap & { id: string }> = [];
  for (const overlap of overlaps) {
    if (overlap.id === undefined || overlap.id.trim() === "") {
      continue;
    }
    out.push({ ...overlap, id: overlap.id.trim() });
  }
  return out;
}

export function relationQuestions(
  overlaps: readonly JevOverlap[],
): Record<string, ChoiceQuestion | NoulQuestion> {
  const linkable = linkableOverlaps(overlaps);
  if (linkable.length === 0) {
    return {};
  }
  if (linkable.length <= RELATION_CHOICE_MAX_OVERLAPS) {
    return { relation: relationChoice(linkable) };
  }
  const questions: Record<string, NoulQuestion> = {};
  for (const [index, overlap] of linkable.entries()) {
    questions[`conflicts_with_${index}`] = {
      type: "noul",
      instructions: `Does this section conflict with observation ${overlap.id}? Conflict means the two claims cannot both stay current: the section supersedes or contradicts that observation.`,
      criteria: {
        true: "The section supersedes or contradicts this observation.",
        false: "The section supports, extends, or is unrelated to this observation.",
      },
    };
  }
  return questions;
}

export function interpretRelation(input: {
  answers: Record<string, JudgeAnswer>;
  overlaps: readonly JevOverlap[];
  confidence: number;
  retain: boolean;
}): InterpretedRelation {
  const linkable = linkableOverlaps(input.overlaps);
  if (linkable.length === 0) {
    return {};
  }
  if (linkable.length <= RELATION_CHOICE_MAX_OVERLAPS) {
    return interpretChoice(input.answers.relation, linkable, input.confidence, input.retain);
  }
  return interpretNouls(input.answers, linkable, input.confidence, input.retain);
}

function relationChoice(
  overlaps: readonly (JevOverlap & { id: string })[],
): ChoiceQuestion {
  const criteria: ChoiceQuestion["criteria"] = {};
  for (const id of OBSERVATION_RELATIONS) {
    const spec = RELATION_CRITERIA[id];
    criteria[id] = {
      what: spec.what,
      not_for: spec.not_for,
      examples: [...spec.examples],
    };
  }
  const ids = overlaps.map((overlap) => overlap.id).join(", ");
  return {
    type: "choice",
    instructions: {
      question: "How does this section relate to the overlapping observations?",
      focus: `Compare the section with observation ids: ${ids}. Pick the strongest relation. A supersedes or contradicts answer applies to every listed id.`,
    },
    criteria,
  };
}

function interpretChoice(
  answer: JudgeAnswer | undefined,
  overlaps: readonly (JevOverlap & { id: string })[],
  confidence: number,
  retain: boolean,
): InterpretedRelation {
  const relation = readRelation(answer);
  if (relation === undefined) {
    return {};
  }
  const observationIds = overlaps.map((overlap) => overlap.id);
  const read: ObservationRelationRead = { ...relation, observationIds };
  const confident = relation.confidence + 1e-9 >= confidence;
  const linkRelation = relation.choice;
  if (
    !retain ||
    !confident ||
    (linkRelation !== "supersedes" && linkRelation !== "contradicts")
  ) {
    return { relation: read };
  }
  return {
    relation: read,
    observationLinks: observationIds.map((observationId) => ({
      relation: linkRelation,
      observationId,
    })),
  };
}

function interpretNouls(
  answers: Record<string, JudgeAnswer>,
  overlaps: readonly (JevOverlap & { id: string })[],
  confidence: number,
  retain: boolean,
): InterpretedRelation {
  const conflicts: ObservationConflictRead[] = [];
  const observationLinks: ObservationLink[] = [];
  for (const [index, overlap] of overlaps.entries()) {
    const noul = readNoul(answers[`conflicts_with_${index}`]);
    if (noul === undefined) {
      continue;
    }
    const band = noulBand(noul, confidence);
    conflicts.push({ observationId: overlap.id, noul, band });
    if (retain && band === "yes") {
      observationLinks.push({
        relation: "contradicts",
        observationId: overlap.id,
      });
    }
  }
  if (conflicts.length === 0) {
    return {};
  }
  return {
    conflicts,
    ...(observationLinks.length > 0 ? { observationLinks } : {}),
  };
}

function readRelation(
  answer: JudgeAnswer | undefined,
): Omit<ObservationRelationRead, "observationIds"> | undefined {
  if (
    answer === undefined ||
    answer.type !== "choice" ||
    !Number.isFinite(answer.confidence)
  ) {
    return undefined;
  }
  if (!isObservationRelation(answer.choice)) {
    return undefined;
  }
  return {
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities: { ...answer.probabilities },
  };
}

function readNoul(answer: JudgeAnswer | undefined): number | undefined {
  if (answer === undefined || answer.type !== "noul" || !Number.isFinite(answer.noul)) {
    return undefined;
  }
  return answer.noul;
}

function isObservationRelation(value: string): value is ObservationRelation {
  return (OBSERVATION_RELATIONS as readonly string[]).includes(value);
}

function noulBand(
  noul: number,
  confidence: number,
): "yes" | "no" | "uncertain" {
  if (!Number.isFinite(noul) || noul < 0 || noul > 1) {
    return "uncertain";
  }
  const yes = noul + 1e-9 >= confidence;
  const no = noul <= 1 - confidence + 1e-9;
  if (yes === no) {
    return "uncertain";
  }
  return yes ? "yes" : "no";
}
