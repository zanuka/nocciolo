import {
  listStarterMentalModelIds,
  STARTER_MENTAL_MODELS,
} from "../providers/hindsight/mental-models.js";
import type {
  BankTemplateInput,
  MentalModelRefreshPolicy,
  MentalModelTaggingMode,
} from "../providers/hindsight/types.js";
import {
  isInteractive,
  promptLine,
  promptMultiSelect,
} from "../utils/prompt.js";

export interface ConfigureWizardFlags {
  yes?: boolean;
  dryRun?: boolean;
  models?: string;
  taggingMode?: string;
  refreshPolicy?: string;
}

export async function resolveBankTemplateInput(input: {
  projectName: string;
  bankId: string;
  flags: ConfigureWizardFlags;
}): Promise<BankTemplateInput> {
  const fromFlags = templateInputFromFlags(input);
  if (fromFlags !== null) {
    return fromFlags;
  }

  const shouldPrompt =
    !input.flags.yes &&
    !input.flags.dryRun &&
    isInteractive() &&
    input.flags.models === undefined &&
    input.flags.taggingMode === undefined &&
    input.flags.refreshPolicy === undefined;

  if (!shouldPrompt) {
    return {
      projectName: input.projectName,
      bankId: input.bankId,
    };
  }

  return runConfigureWizard({
    projectName: input.projectName,
    bankId: input.bankId,
  });
}

function templateInputFromFlags(input: {
  projectName: string;
  bankId: string;
  flags: ConfigureWizardFlags;
}): BankTemplateInput | null {
  const hasExplicit =
    input.flags.models !== undefined ||
    input.flags.taggingMode !== undefined ||
    input.flags.refreshPolicy !== undefined ||
    input.flags.yes === true;

  if (!hasExplicit && isInteractive() && !input.flags.dryRun) {
    return null;
  }

  return {
    projectName: input.projectName,
    bankId: input.bankId,
    ...(input.flags.models !== undefined
      ? { mentalModelIds: parseModelIds(input.flags.models) }
      : {}),
    ...(input.flags.taggingMode !== undefined
      ? { taggingMode: parseTaggingMode(input.flags.taggingMode) }
      : {}),
    ...(input.flags.refreshPolicy !== undefined
      ? { refreshPolicy: parseRefreshPolicy(input.flags.refreshPolicy) }
      : {}),
  };
}

export async function runConfigureWizard(input: {
  projectName: string;
  bankId: string;
}): Promise<BankTemplateInput> {
  console.log("");
  console.log("Configure mental-model starters for the bank template.");
  console.log(
    "Models stay empty until seed + refresh. Apply remains a separate step.",
  );
  console.log("");

  const starterLabels = STARTER_MENTAL_MODELS.map(
    (s) => `${s.id} (${s.name})`,
  );
  const pickedLabels = await promptMultiSelect(
    "Starter mental models (blank = all defaults)",
    starterLabels,
  );
  let mentalModelIds = listStarterMentalModelIds();
  if (pickedLabels.length > 0) {
    mentalModelIds = pickedLabels.map((label) => label.split(" ")[0]!);
  } else {
    const blankMeansAll = await promptLine(
      "No selection entered. Include all starter models?",
      { defaultValue: "Y" },
    );
    if (blankMeansAll.trim().toLowerCase().startsWith("n")) {
      mentalModelIds = [];
    }
  }

  const taggingAnswer = await promptLine(
    "Tagging mode: topic-scoped (default), project-wide, or custom",
    { defaultValue: "topic-scoped" },
  );
  const taggingMode = parseTaggingMode(taggingAnswer);

  const customTagsByModelId: Record<string, string[]> = {};
  if (taggingMode === "custom") {
    for (const id of mentalModelIds) {
      const spec = STARTER_MENTAL_MODELS.find((s) => s.id === id);
      const defaultTags = (spec?.topicTags ?? []).join(",");
      const answer = await promptLine(`Tags for ${id} (comma-separated)`, {
        defaultValue: defaultTags,
      });
      customTagsByModelId[id] = parseTagList(answer);
    }
  }

  const refreshAnswer = await promptLine(
    "Refresh policy: differentiated (default), auto, or manual",
    { defaultValue: "differentiated" },
  );
  const refreshPolicy = parseRefreshPolicy(refreshAnswer);

  console.log("");
  console.log("Review:");
  console.log(`  models: ${mentalModelIds.join(", ") || "(none)"}`);
  console.log(`  tagging: ${taggingMode}`);
  console.log(`  refresh: ${refreshPolicy}`);
  console.log(
    "  differentiated = auto for project-context/architecture; manual for coding-standards",
  );
  const confirm = await promptLine("Write bank template?", {
    defaultValue: "Y",
  });
  if (confirm.trim().toLowerCase().startsWith("n")) {
    throw new Error(
      "Configure cancelled. Re-run `nocciolo configure` when ready.",
    );
  }

  return {
    projectName: input.projectName,
    bankId: input.bankId,
    mentalModelIds,
    taggingMode,
    ...(taggingMode === "custom" ? { customTagsByModelId } : {}),
    refreshPolicy,
  };
}

function parseModelIds(raw: string): string[] {
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (ids.length === 0) {
    return [];
  }
  const known = new Set(listStarterMentalModelIds());
  for (const id of ids) {
    if (!known.has(id)) {
      throw new Error(
        `Unknown mental model id "${id}". Valid: ${listStarterMentalModelIds().join(", ")}`,
      );
    }
  }
  return ids;
}

function parseTaggingMode(raw: string): MentalModelTaggingMode {
  const value = raw.trim().toLowerCase();
  if (
    value === "topic-scoped" ||
    value === "topic" ||
    value === "topic_scoped"
  ) {
    return "topic-scoped";
  }
  if (
    value === "project-wide" ||
    value === "project" ||
    value === "project_wide"
  ) {
    return "project-wide";
  }
  if (value === "custom") {
    return "custom";
  }
  throw new Error(
    `Unknown tagging mode "${raw}". Use topic-scoped, project-wide, or custom.`,
  );
}

function parseRefreshPolicy(raw: string): MentalModelRefreshPolicy {
  const value = raw.trim().toLowerCase();
  if (value === "auto") {
    return "auto";
  }
  if (value === "manual") {
    return "manual";
  }
  if (value === "differentiated" || value === "diff" || value === "default") {
    return "differentiated";
  }
  throw new Error(
    `Unknown refresh policy "${raw}". Use differentiated, auto, or manual.`,
  );
}

function parseTagList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
