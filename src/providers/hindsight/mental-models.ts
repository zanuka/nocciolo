import type {
  HindsightMentalModel,
  HindsightMentalModelTrigger,
  MentalModelRefreshPolicy,
  MentalModelTaggingMode,
} from "./types.js";

export const SEED_SHARED_TAG = "nocciolo";

export interface StarterMentalModelSpec {
  id: string;
  name: string;
  sourceQuery: (projectName: string) => string;
  maxTokens: number;
  topicTags: string[];
  multiTagMatch?: "any";
  defaultRefresh: "auto" | "manual";
}

export const STARTER_MENTAL_MODELS: StarterMentalModelSpec[] = [
  {
    id: "project-context",
    name: "Project Context",
    sourceQuery: (name) =>
      `What is ${name}'s purpose, tech stack, architecture, and key conventions? What are the main components and how do they fit together?`,
    maxTokens: 2048,
    topicTags: [SEED_SHARED_TAG],
    defaultRefresh: "auto",
  },
  {
    id: "architecture-decisions",
    name: "Architecture Decisions",
    sourceQuery: (name) =>
      `What architectural decisions have been made for ${name}, including trade-offs and rationale?`,
    maxTokens: 2048,
    topicTags: ["knowledge:architecture", "knowledge:decision"],
    multiTagMatch: "any",
    defaultRefresh: "auto",
  },
  {
    id: "coding-standards",
    name: "Coding Standards",
    sourceQuery: (name) =>
      `What coding standards, style rules, and engineering practices should agents follow in ${name}?`,
    maxTokens: 1536,
    topicTags: ["knowledge:standard"],
    defaultRefresh: "manual",
  },
];

export function listStarterMentalModelIds(): string[] {
  return STARTER_MENTAL_MODELS.map((s) => s.id);
}

export function resolveRefreshAfterConsolidation(
  policy: MentalModelRefreshPolicy,
  defaultRefresh: "auto" | "manual",
): boolean {
  if (policy === "auto") {
    return true;
  }
  if (policy === "manual") {
    return false;
  }
  return defaultRefresh === "auto";
}

export function tagsForStarter(input: {
  spec: StarterMentalModelSpec;
  taggingMode: MentalModelTaggingMode;
  customTags?: string[];
}): { tags: string[]; tagsMatch?: "any" } {
  if (input.taggingMode === "project-wide") {
    return { tags: [SEED_SHARED_TAG] };
  }
  if (input.taggingMode === "custom") {
    const tags =
      input.customTags && input.customTags.length > 0
        ? input.customTags
        : input.spec.topicTags;
    return {
      tags,
      ...(tags.length > 1 ? { tagsMatch: "any" as const } : {}),
    };
  }
  return {
    tags: input.spec.topicTags,
    ...(input.spec.multiTagMatch !== undefined
      ? { tagsMatch: input.spec.multiTagMatch }
      : {}),
  };
}

export function buildStarterMentalModels(input: {
  projectName: string;
  mentalModelIds?: string[];
  taggingMode?: MentalModelTaggingMode;
  customTagsByModelId?: Record<string, string[]>;
  refreshPolicy?: MentalModelRefreshPolicy;
}): HindsightMentalModel[] {
  const taggingMode = input.taggingMode ?? "topic-scoped";
  const refreshPolicy = input.refreshPolicy ?? "differentiated";
  const wanted = new Set(
    input.mentalModelIds ?? listStarterMentalModelIds(),
  );

  const models: HindsightMentalModel[] = [];
  for (const spec of STARTER_MENTAL_MODELS) {
    if (!wanted.has(spec.id)) {
      continue;
    }
    const { tags, tagsMatch } = tagsForStarter({
      spec,
      taggingMode,
      ...(input.customTagsByModelId?.[spec.id] !== undefined
        ? { customTags: input.customTagsByModelId[spec.id] }
        : {}),
    });
    const trigger: HindsightMentalModelTrigger = {
      refresh_after_consolidation: resolveRefreshAfterConsolidation(
        refreshPolicy,
        spec.defaultRefresh,
      ),
      ...(tagsMatch !== undefined ? { tags_match: tagsMatch } : {}),
    };
    models.push({
      id: spec.id,
      name: spec.name,
      source_query: spec.sourceQuery(input.projectName),
      max_tokens: spec.maxTokens,
      tags,
      trigger,
    });
  }
  return models;
}

export function mentalModelToTemplateEntry(
  model: HindsightMentalModel,
): HindsightMentalModel {
  return {
    id: model.id,
    name: model.name,
    source_query: model.source_query,
    max_tokens: model.max_tokens,
    tags: [...model.tags],
    trigger: { ...model.trigger },
  };
}
