import { loadConfig, loadShareConfig } from "../config/load.js";
import {
  assertApiKeyForConnection,
  resolveProjectConnection,
} from "../config/connection.js";
import { bankTemplatePath } from "../config/paths.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  HindsightClient,
  resolveHindsightApiKey,
  type MentalModelRecord,
  type MentalModelTriggerPayload,
} from "../providers/hindsight/client.js";
import { mentalModelToTemplateEntry } from "../providers/hindsight/mental-models.js";
import {
  collectOperationIds,
  pollOperationUntilDone,
} from "../providers/hindsight/operations.js";
import { refreshDeclaredMentalModels } from "../providers/hindsight/refresh-models.js";
import type {
  HindsightBankTemplate,
  HindsightMentalModel,
  MentalModelTagsMatch,
} from "../providers/hindsight/types.js";
import { NoccioloError } from "../utils/errors.js";
import { pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";

export type MentalModelAction =
  | "list"
  | "get"
  | "create"
  | "update"
  | "refresh"
  | "clear"
  | "tags";

export interface MentalModelCommandOptions {
  cwd?: string;
  action: MentalModelAction;
  id?: string;
  all?: boolean;
  dryRun?: boolean;
  name?: string;
  sourceQuery?: string;
  tags?: string;
  tagsMatch?: string;
  maxTokens?: number;
  refreshAfterConsolidation?: boolean;
  mode?: string;
  detail?: string;
  source?: "memories" | "mental_models";
  saveTemplate?: boolean;
  hindsightUrl?: string;
  apiKey?: string;
}

function resolveClient(options: MentalModelCommandOptions): Promise<{
  client: HindsightClient;
  bankId: string;
  projectRoot: string;
  baseUrl: string;
}> {
  return (async () => {
    const cwd = options.cwd ?? process.cwd();
    const projectRoot = await detectProjectRoot(cwd);
    const config = await loadConfig(projectRoot);
    const share = await loadShareConfig(projectRoot);
    const connection = resolveProjectConnection({
      config,
      share,
      ...(options.hindsightUrl !== undefined
        ? { cliUrl: options.hindsightUrl }
        : {}),
    });
    const apiKey = resolveHindsightApiKey({
      ...(options.apiKey !== undefined ? { cliKey: options.apiKey } : {}),
    });
    const needsNetwork =
      !options.dryRun ||
      options.action === "list" ||
      options.action === "get" ||
      options.action === "tags" ||
      options.action === "refresh";
    if (needsNetwork) {
      assertApiKeyForConnection({
        connection,
        ...(apiKey ? { apiKey } : {}),
      });
    }
    const client = new HindsightClient({
      baseUrl: connection.baseUrl,
      ...(apiKey !== undefined ? { apiKey } : {}),
    });
    return {
      client,
      bankId: config.bankId,
      projectRoot,
      baseUrl: connection.baseUrl,
    };
  })();
}

export async function runMentalModelCommand(
  options: MentalModelCommandOptions,
): Promise<void> {
  const { client, bankId, projectRoot, baseUrl } = await resolveClient(options);
  const prefix = options.dryRun ? "[dry-run] " : "";

  switch (options.action) {
    case "list":
      await listModels(client, bankId, baseUrl, options.detail ?? "metadata");
      return;
    case "get":
      await getModel(client, bankId, requireId(options.id), options.detail);
      return;
    case "tags":
      await listTags(client, bankId, options.source ?? "mental_models");
      return;
    case "create":
      await createModel(client, bankId, projectRoot, prefix, options);
      return;
    case "update":
      await updateModel(client, bankId, projectRoot, prefix, options);
      return;
    case "refresh":
      await refreshModels(client, bankId, projectRoot, prefix, options);
      return;
    case "clear":
      await clearModel(client, bankId, prefix, options);
      return;
    default:
      throw new NoccioloError(
        `Unknown mental-model action`,
        "Use list, get, create, update, refresh, clear, or tags.",
      );
  }
}

async function listModels(
  client: HindsightClient,
  bankId: string,
  baseUrl: string,
  detail: string,
): Promise<void> {
  console.log(`Mental models for bank "${bankId}"`);
  console.log(`Hindsight: ${baseUrl}`);
  console.log("");
  const page = await client.listMentalModels(bankId, { detail, limit: 100 });
  if (page.items.length === 0) {
    console.log("No mental models found.");
    console.log(
      "Declare models in the bank template, then `nocciolo bank apply`, seed, and refresh.",
    );
    return;
  }
  for (const model of page.items) {
    console.log(formatModelLine(model));
  }
  console.log("");
  console.log(`Total: ${page.total}`);
}

async function getModel(
  client: HindsightClient,
  bankId: string,
  id: string,
  detail?: string,
): Promise<void> {
  const model = await client.getMentalModel(bankId, id, {
    ...(detail !== undefined ? { detail } : {}),
  });
  console.log(JSON.stringify(model, null, 2));
}

async function listTags(
  client: HindsightClient,
  bankId: string,
  source: "memories" | "mental_models",
): Promise<void> {
  const response = await client.listBankTags(bankId, { source });
  console.log(`Tags (source=${source}) for bank "${bankId}"`);
  console.log("");
  const tags = normalizeTags(response);
  if (tags.length === 0) {
    console.log("No tags found.");
    return;
  }
  for (const tag of tags) {
    console.log(`  ${tag}`);
  }
}

async function createModel(
  client: HindsightClient,
  bankId: string,
  projectRoot: string,
  prefix: string,
  options: MentalModelCommandOptions,
): Promise<void> {
  const name = options.name?.trim();
  const sourceQuery = options.sourceQuery?.trim();
  if (!name || !sourceQuery) {
    throw new NoccioloError(
      "create requires --name and --source-query",
      "Example: nocciolo mental-model create --name 'FAQ' --source-query 'What are the FAQs?' --id faq",
    );
  }
  const body = {
    ...(options.id !== undefined ? { id: options.id } : {}),
    name,
    source_query: sourceQuery,
    ...(options.tags !== undefined ? { tags: parseTagList(options.tags) } : {}),
    ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    trigger: buildTrigger(options),
  };

  if (options.dryRun) {
    console.log(`${prefix}Would create mental model:`);
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const response = await client.createMentalModel(bankId, body);
  console.log(`Created mental model${body.id ? ` "${body.id}"` : ""}.`);
  await pollCreateOrRefresh(client, bankId, response);
  if (options.saveTemplate && body.id) {
    await upsertTemplateModel(projectRoot, {
      id: body.id,
      name: body.name,
      source_query: body.source_query,
      max_tokens: body.max_tokens ?? 2048,
      tags: body.tags ?? [],
      trigger: {
        refresh_after_consolidation:
          body.trigger.refresh_after_consolidation ?? false,
        ...(body.trigger.tags_match !== undefined
          ? { tags_match: body.trigger.tags_match as MentalModelTagsMatch }
          : {}),
        ...(body.trigger.mode !== undefined
          ? { mode: body.trigger.mode as "full" | "delta" }
          : {}),
        ...(body.trigger.min_refresh_interval_seconds !== undefined
          ? {
              min_refresh_interval_seconds:
                body.trigger.min_refresh_interval_seconds,
            }
          : {}),
      },
    });
    console.log("Wrote declaration into bank-template.json (--save-template).");
  }
}

async function updateModel(
  client: HindsightClient,
  bankId: string,
  projectRoot: string,
  prefix: string,
  options: MentalModelCommandOptions,
): Promise<void> {
  const id = requireId(options.id);
  const body: {
    name?: string;
    source_query?: string;
    tags?: string[];
    max_tokens?: number;
    trigger?: MentalModelTriggerPayload;
  } = {};
  if (options.name !== undefined) {
    body.name = options.name;
  }
  if (options.sourceQuery !== undefined) {
    body.source_query = options.sourceQuery;
  }
  if (options.tags !== undefined) {
    body.tags = parseTagList(options.tags);
  }
  if (options.maxTokens !== undefined) {
    body.max_tokens = options.maxTokens;
  }
  const trigger = buildTrigger(options);
  if (Object.keys(trigger).length > 0) {
    body.trigger = trigger;
  }

  if (options.dryRun) {
    console.log(`${prefix}Would update mental model "${id}":`);
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const updated = await client.updateMentalModel(bankId, id, body);
  console.log(`Updated mental model "${id}".`);
  if (options.saveTemplate) {
    const full = await client.getMentalModel(bankId, id, { detail: "content" });
    await upsertTemplateModel(projectRoot, recordToTemplateModel(full, updated));
    console.log("Wrote declaration into bank-template.json (--save-template).");
  }
}

async function refreshModels(
  client: HindsightClient,
  bankId: string,
  projectRoot: string,
  prefix: string,
  options: MentalModelCommandOptions,
): Promise<void> {
  if (options.all) {
    const templatePath = bankTemplatePath(projectRoot);
    if (!(await pathExists(templatePath))) {
      throw new NoccioloError(
        `Bank template not found at ${templatePath}`,
        "Run `nocciolo configure` or pass a specific model id.",
      );
    }
    const template = await readJsonFile<HindsightBankTemplate>(templatePath);
    if (options.dryRun) {
      console.log(
        `${prefix}Would refresh ${template.mental_models.length} declared model(s).`,
      );
    }
    const result = await refreshDeclaredMentalModels({
      client,
      bankId,
      template,
      dryRun: options.dryRun ?? false,
    });
    if (options.dryRun) {
      for (const preview of result.previews) {
        console.log(`${prefix}${preview.id}: ${preview.summary}`);
      }
      return;
    }
    console.log(
      `Refreshed ${result.refreshed.length} model(s): ${result.refreshed.join(", ")}`,
    );
    return;
  }

  const id = requireId(options.id);
  if (options.dryRun) {
    try {
      const preview = await client.dryRunRefreshMentalModel(bankId, id);
      console.log(`${prefix}Dry-run refresh for "${id}":`);
      console.log(JSON.stringify(preview, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(
        `${prefix}Would refresh mental model "${id}" (dry-run-refresh failed: ${message}).`,
      );
    }
    return;
  }

  console.log(`Refreshing mental model "${id}"...`);
  const response = await client.refreshMentalModel(bankId, id);
  await pollCreateOrRefresh(client, bankId, response);
  console.log(`Refresh queued/completed for "${id}".`);
}

async function clearModel(
  client: HindsightClient,
  bankId: string,
  prefix: string,
  options: MentalModelCommandOptions,
): Promise<void> {
  const id = requireId(options.id);
  if (options.dryRun) {
    console.log(
      `${prefix}Would clear mental model "${id}" (next refresh becomes a full re-synthesis).`,
    );
    return;
  }
  await client.clearMentalModel(bankId, id);
  console.log(
    `Cleared mental model "${id}". Run refresh for a full re-synthesis.`,
  );
}

async function pollCreateOrRefresh(
  client: HindsightClient,
  bankId: string,
  response: { operation_id?: string; operation_ids?: string[] },
): Promise<void> {
  const operationIds = collectOperationIds(response);
  for (const operationId of operationIds) {
    console.log(`Tracking operation ${operationId}...`);
    await pollOperationUntilDone(client, bankId, operationId);
  }
}

function buildTrigger(
  options: MentalModelCommandOptions,
): MentalModelTriggerPayload {
  const trigger: MentalModelTriggerPayload = {};
  if (options.refreshAfterConsolidation !== undefined) {
    trigger.refresh_after_consolidation = options.refreshAfterConsolidation;
  }
  if (options.tagsMatch !== undefined) {
    trigger.tags_match = options.tagsMatch;
  }
  if (options.mode !== undefined) {
    trigger.mode = options.mode;
  }
  return trigger;
}

function requireId(id: string | undefined): string {
  if (!id || id.trim().length === 0) {
    throw new NoccioloError(
      "Mental model id is required",
      "Pass <id> or use --all for refresh of declared template models.",
    );
  }
  return id.trim();
}

function parseTagList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function formatModelLine(model: MentalModelRecord): string {
  const tags = (model.tags ?? []).join(",") || "-";
  const stale =
    model.is_stale === true
      ? " stale"
      : model.last_refresh_failed_at
        ? " refresh_failed"
        : "";
  const refreshed = model.last_refreshed_at
    ? ` last_refreshed=${model.last_refreshed_at}`
    : "";
  return `- ${model.id}: ${model.name} tags=[${tags}]${stale}${refreshed}`;
}

function normalizeTags(response: {
  tags?: string[];
  items?: Array<{ tag?: string; count?: number }>;
}): string[] {
  if (Array.isArray(response.tags) && response.tags.length > 0) {
    return response.tags;
  }
  if (Array.isArray(response.items)) {
    return response.items
      .map((item) => item.tag)
      .filter((tag): tag is string => typeof tag === "string" && tag.length > 0);
  }
  return [];
}

function recordToTemplateModel(
  full: MentalModelRecord,
  fallback: MentalModelRecord,
): HindsightMentalModel {
  const source = full.source_query ?? fallback.source_query;
  if (!source) {
    throw new NoccioloError(
      `Mental model "${full.id}" has no source_query`,
      "Fetch with detail=content or set --source-query before --save-template.",
    );
  }
  const trigger = full.trigger ?? fallback.trigger ?? {};
  return {
    id: full.id,
    name: full.name,
    source_query: source,
    max_tokens: full.max_tokens ?? fallback.max_tokens ?? 2048,
    tags: full.tags ?? fallback.tags ?? [],
    trigger: {
      refresh_after_consolidation:
        trigger.refresh_after_consolidation ?? false,
      ...(trigger.tags_match !== undefined
        ? { tags_match: trigger.tags_match as MentalModelTagsMatch }
        : {}),
      ...(trigger.mode === "full" || trigger.mode === "delta"
        ? { mode: trigger.mode }
        : {}),
      ...(typeof trigger.min_refresh_interval_seconds === "number"
        ? {
            min_refresh_interval_seconds: trigger.min_refresh_interval_seconds,
          }
        : {}),
    },
  };
}

async function upsertTemplateModel(
  projectRoot: string,
  model: HindsightMentalModel,
): Promise<void> {
  const templatePath = bankTemplatePath(projectRoot);
  if (!(await pathExists(templatePath))) {
    throw new NoccioloError(
      `Bank template not found at ${templatePath}`,
      "Run `nocciolo configure` before --save-template.",
    );
  }
  const template = await readJsonFile<HindsightBankTemplate>(templatePath);
  const entry = mentalModelToTemplateEntry(model);
  const index = template.mental_models.findIndex((m) => m.id === entry.id);
  if (index === -1) {
    template.mental_models.push(entry);
  } else {
    template.mental_models[index] = entry;
  }
  await writeJsonFile(templatePath, template, false);
}
