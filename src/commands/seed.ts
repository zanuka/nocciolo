import { loadConfig, loadShareConfig } from "../config/load.js";
import {
  assertApiKeyForConnection,
  resolveProjectConnection,
} from "../config/connection.js";
import { bankTemplatePath } from "../config/paths.js";
import {
  applyRelevanceRows,
  containsInlineSecret,
  createJudge,
  formatRelevanceLines,
  formatSecretSkipWarning,
  judgeSeedRelevance,
  observationRecallQuery,
  recalledToOverlaps,
  type RelevanceReport,
  type ResolvedJudge,
} from "../judge/index.js";
import type { CandidateFact } from "../extractor/types.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  formatPercent,
  HindsightClient,
  resolveHindsightApiKey,
  type RecalledObservation,
  type RetainItem,
} from "../providers/hindsight/client.js";
import {
  collectOperationIds,
  pollOperationUntilDone,
  refreshDeclaredMentalModels,
} from "../providers/hindsight/operations.js";
import type { HindsightBankTemplate } from "../providers/hindsight/types.js";
import {
  createEmptyManifest,
  loadSeedManifest,
  saveSeedManifest,
} from "../seeder/manifest.js";
import {
  nextManifest,
  prepareSeed,
  toRetainItems,
  type PreparedSeed,
} from "../seeder/prepare.js";
import { clearTombstonesForIds } from "../seeder/tombstones.js";
import { formatError, isAuthError } from "../utils/errors.js";
import { pathExists, readJsonFile } from "../utils/fs.js";

export interface SeedOptions {
  cwd?: string;
  dryRun?: boolean;
  force?: boolean;
  hindsightUrl?: string;
  apiKey?: string;
  async?: boolean;
  refreshMentalModels?: boolean;
  judge?: string;
  confidence?: number;
  strict?: boolean;
  resolvedJudge?: ResolvedJudge;
  client?: HindsightClient;
  recallObservations?: (
    bankId: string,
    query: string,
  ) => Promise<readonly RecalledObservation[]>;
}

export interface SeedResult {
  prepared: PreparedSeed;
  baseUrl: string;
  dryRun: boolean;
  retained: number;
  async: boolean;
  failed: number;
  relevance?: RelevanceReport;
}

export async function runSeed(options: SeedOptions = {}): Promise<SeedResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const asyncRetain = options.async ?? false;
  const refreshMentalModels = options.refreshMentalModels ?? false;

  const resolved =
    options.resolvedJudge ??
    createJudge({
      ...(options.judge !== undefined ? { judge: options.judge } : {}),
      ...(options.confidence !== undefined
        ? { confidence: options.confidence }
        : {}),
      ...(options.strict !== undefined ? { strict: options.strict } : {}),
    });

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
  const baseUrl = connection.baseUrl;
  const apiKey = resolveHindsightApiKey({
    ...(options.apiKey !== undefined ? { cliKey: options.apiKey } : {}),
  });

  if (!dryRun) {
    assertApiKeyForConnection({ connection, ...(apiKey ? { apiKey } : {}) });
  }

  if (!dryRun && !apiKey && !connection.requiresApiKey) {
    console.log(
      "Warning: no API key resolved (NOCCIOLO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY / --api-key).",
    );
    console.log(
      "If your Hindsight server requires auth, retain will fail with 401.",
    );
    console.log("");
  }
  let prepared = await prepareSeed({
    projectRoot,
    bankId: config.bankId,
    force,
    ...(config.scanner !== undefined ? { scanner: config.scanner } : {}),
  });

  let relevance: RelevanceReport | undefined;
  let recalledObservations = false;
  const heuristicSkips = prepared.sources
    .filter((source) => !source.unchanged)
    .flatMap((source) => source.heuristicSkips);
  if (
    resolved.judgeId === "jev" &&
    (prepared.factsToRetain.length > 0 || heuristicSkips.length > 0)
  ) {
    const mission = await loadRetainMission(projectRoot);
    const recall = resolveObservationRecall({
      options,
      baseUrl,
      apiKey,
    });
    let recallDisabled = false;
    const overlapsFor =
      recall === undefined
        ? undefined
        : async (fact: CandidateFact) => {
            if (recallDisabled) {
              return [];
            }
            if (
              containsInlineSecret(fact.content) ||
              containsInlineSecret(fact.title) ||
              containsInlineSecret(fact.provenance.sourcePath)
            ) {
              return [];
            }
            const query = observationRecallQuery(fact);
            if (query === "") {
              return [];
            }
            try {
              const results = await recall(config.bankId, query);
              const overlaps = recalledToOverlaps(results);
              if (overlaps.length > 0) {
                recalledObservations = true;
              }
              return overlaps;
            } catch {
              recallDisabled = true;
              console.log(
                "Warning: overlapping observations were not loaded, so the contradiction check was skipped.",
              );
              console.log(
                "If this is the first seed, the bank may not exist yet. Retain still proceeds.",
              );
              return [];
            }
          };
    const rows = await judgeSeedRelevance({
      facts: prepared.factsToRetain,
      heuristicSkips,
      judge: resolved.judge,
      confidence: resolved.confidence,
      ...(mission !== undefined ? { mission } : {}),
      ...(overlapsFor !== undefined ? { overlapsFor } : {}),
    });
    const applied = applyRelevanceRows(prepared, rows);
    prepared = applied.prepared;
    relevance = {
      confidence: resolved.confidence,
      rows,
      settleEmptyPaths: applied.settleEmptyPaths,
      reopenPaths: applied.reopenPaths,
      ...(mission !== undefined ? { mission } : {}),
    };
    for (const line of formatRelevanceLines({
      rows,
      confidence: resolved.confidence,
      dryRun,
      ...(mission !== undefined ? { mission } : {}),
    })) {
      console.log(line);
    }
    for (const row of rows) {
      if (row.warnSecret === true) {
        console.error(formatSecretSkipWarning(row.fact.provenance.sourcePath));
      }
    }
    console.log("");
  }

  printSeedPlan({
    prepared,
    baseUrl,
    dryRun,
    asyncRetain,
  });

  if (dryRun) {
    if (recalledObservations) {
      console.log(
        "Overlapping observations were recalled (read-only). Nothing was written.",
      );
    }
    console.log(
      "No memories were retained. Re-run without --dry-run to call Hindsight.",
    );
    if (refreshMentalModels) {
      console.log("");
      console.log(
        "[dry-run] --refresh-mental-models: would refresh declared models after retain.",
      );
      console.log(
        "Models with refresh_after_consolidation may also queue after Hindsight consolidates; this flag waits for retain then refreshes explicitly.",
      );
    }
    return {
      prepared,
      baseUrl,
      dryRun: true,
      retained: 0,
      async: asyncRetain,
      failed: 0,
      ...(relevance !== undefined ? { relevance } : {}),
    };
  }

  const client =
    options.client ??
    new HindsightClient({
      baseUrl,
      ...(apiKey !== undefined ? { apiKey } : {}),
    });

  let retainedIds = new Set<string>();
  let failed = 0;

  if (prepared.factsToRetain.length === 0) {
    console.log("Nothing was sent to Hindsight.");
  } else {
    const retainResult = await retainPreparedItems({
      client,
      bankId: config.bankId,
      items: toRetainItems(prepared.factsToRetain),
      asyncRetain,
      retryHint: "NOCCIOLO_HINDSIGHT_API_KEY='your-key' pnpm nocciolo seed",
    });
    retainedIds = retainResult.retainedIds;
    failed = retainResult.failed;

    console.log("");
    if (retainedIds.size > 0) {
      console.log(
        `Retained ${retainedIds.size} item(s)${asyncRetain ? " (async)" : ""}${failed > 0 ? `, ${failed} failed` : ""}.`,
      );
    } else {
      console.log("Nothing was successfully retained.");
    }
  }

  if (shouldPersistSeedManifest(retainedIds, relevance)) {
    await persistSeedManifest({
      projectRoot,
      bankId: config.bankId,
      prepared,
      retainedIds,
      ...(relevance !== undefined ? { relevance } : {}),
    });
    if (retainedIds.size > 0) {
      console.log(
        "Incremental state saved under .nocciolo/local/seed-manifest.json",
      );
      console.log(
        "Hindsight may still run consolidation in the background. It is safe to close the terminal after retain finishes.",
      );
    }
    if (
      retainedIds.size === 0 &&
      relevance !== undefined &&
      relevance.settleEmptyPaths.length > 0
    ) {
      console.log(
        "Recorded Jev skip(s) in .nocciolo/local/seed-manifest.json so unchanged files are not judged again.",
      );
    }
    if (relevance !== undefined && relevance.reopenPaths.length > 0) {
      console.log(
        "Left low-confidence candidates out of the seed manifest so the next seed judges them again.",
      );
    }
  }

  if (refreshMentalModels) {
    await runPostSeedMentalModelRefresh({
      client,
      projectRoot,
      bankId: config.bankId,
    });
  }

  return {
    prepared,
    baseUrl,
    dryRun: false,
    retained: retainedIds.size,
    async: asyncRetain,
    failed,
    ...(relevance !== undefined ? { relevance } : {}),
  };
}

async function loadRetainMission(
  projectRoot: string,
): Promise<string | undefined> {
  const templatePath = bankTemplatePath(projectRoot);
  if (!(await pathExists(templatePath))) {
    return undefined;
  }
  const template = await readJsonFile<HindsightBankTemplate>(templatePath);
  const mission = template.bank?.retain_mission?.trim();
  return mission ? mission : undefined;
}

function shouldPersistSeedManifest(
  retainedIds: Set<string>,
  relevance: RelevanceReport | undefined,
): boolean {
  if (retainedIds.size > 0) {
    return true;
  }
  if (relevance === undefined) {
    return false;
  }
  return (
    relevance.settleEmptyPaths.length > 0 || relevance.reopenPaths.length > 0
  );
}

async function persistSeedManifest(input: {
  projectRoot: string;
  bankId: string;
  prepared: PreparedSeed;
  retainedIds: Set<string>;
  relevance?: RelevanceReport;
}): Promise<void> {
  const previous =
    (await loadSeedManifest(input.projectRoot)) ??
    createEmptyManifest(input.bankId);
  const manifest = nextManifest(
    previous,
    input.bankId,
    input.prepared,
    input.retainedIds,
    input.relevance
      ? {
          settleEmptyPaths: new Set(input.relevance.settleEmptyPaths),
          reopenPaths: new Set(input.relevance.reopenPaths),
        }
      : undefined,
  );
  await saveSeedManifest(input.projectRoot, manifest);
  if (input.retainedIds.size > 0) {
    await clearTombstonesForIds(input.projectRoot, input.retainedIds);
  }
}

async function runPostSeedMentalModelRefresh(input: {
  client: HindsightClient;
  projectRoot: string;
  bankId: string;
}): Promise<void> {
  const templatePath = bankTemplatePath(input.projectRoot);
  if (!(await pathExists(templatePath))) {
    console.log("");
    console.log(
      "Skipping --refresh-mental-models: bank template not found. Run `nocciolo configure` first.",
    );
    return;
  }
  const template = await readJsonFile<HindsightBankTemplate>(templatePath);
  if (template.mental_models.length === 0) {
    console.log("");
    console.log("Skipping --refresh-mental-models: template declares no models.");
    return;
  }

  console.log("");
  console.log(
    `Refreshing ${template.mental_models.length} declared mental model(s)...`,
  );
  console.log(
    "Note: models with refresh_after_consolidation may also refresh after consolidation; this is an explicit opt-in refresh after retain.",
  );

  const result = await refreshDeclaredMentalModels({
    client: input.client,
    bankId: input.bankId,
    template,
  });
  console.log(
    `Refreshed ${result.refreshed.length} mental model(s): ${result.refreshed.join(", ")}`,
  );
}

export interface RetainRunResult {
  retainedIds: Set<string>;
  failed: number;
}

/**
 * Shared retain-execution loop for both `seed` and `store`: same client
 * call, same sync/async modes, same progress/warning output. `store` must
 * not reimplement this — it only decides *which* prepared items to pass in.
 */
export async function retainPreparedItems(input: {
  client: HindsightClient;
  bankId: string;
  items: RetainItem[];
  asyncRetain: boolean;
  retryHint: string;
}): Promise<RetainRunResult> {
  const { client, bankId, items, asyncRetain, retryHint } = input;
  const retainedIds = new Set<string>();
  let failed = 0;

  printRetainWarning(items.length, asyncRetain);

  if (asyncRetain) {
    console.log(
      `Submitting ${items.length} item(s) asynchronously to Hindsight...`,
    );
    const response = await client.retain(bankId, {
      items,
      async: true,
    });
    for (const item of items) {
      retainedIds.add(item.document_id);
    }

    const operationIds = collectOperationIds(response);
    if (operationIds.length === 0) {
      console.log(
        "Async retain submitted (no operation id returned). Watch the Hindsight dashboard for progress.",
      );
    } else {
      for (const operationId of operationIds) {
        console.log(`Tracking operation ${operationId}...`);
        await pollOperationUntilDone(client, bankId, operationId);
      }
    }
  } else {
    const total = items.length;
    console.log(
      `Retaining ${total} item(s) synchronously (LLM extraction per item).`,
    );
    console.log("Progress:");
    for (const [index, item] of items.entries()) {
      const n = index + 1;
      const pct = formatPercent(n - 1, total);
      console.log(`  [${n}/${total}] ${pct}  starting  ${item.document_id}`);
      try {
        await client.retain(bankId, {
          items: [item],
          async: false,
        });
        retainedIds.add(item.document_id);
        console.log(
          `  [${n}/${total}] ${formatPercent(n, total)}  done      ${item.document_id}`,
        );
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(`  [${n}/${total}] failed    ${message}`);
        if (isAuthError(error)) {
          console.error("");
          console.error(formatError(error));
          console.error("Stopping early — fix auth and re-run. Example:");
          console.error(`  ${retryHint}`);
          break;
        }
      }
    }
  }

  return { retainedIds, failed };
}

function printRetainWarning(itemCount: number, asyncRetain: boolean): void {
  console.log("");
  console.log("============================================================");
  console.log("Hindsight is processing retain requests.");
  console.log(
    "Do not close this terminal or press Ctrl+C until Nocciolo reports completion.",
  );
  if (asyncRetain) {
    console.log(
      "Async mode: Nocciolo will poll Hindsight operation progress (processed/total when available).",
    );
  } else {
    console.log(
      `Sync mode: ${itemCount} item(s); each can take several seconds. Progress shows as percent of items.`,
    );
  }
  console.log(
    "Interrupting mid-retain can leave a partial bank; re-run seed (use --force if needed).",
  );
  console.log("============================================================");
  console.log("");
}


function printSeedPlan(input: {
  prepared: PreparedSeed;
  baseUrl: string;
  dryRun: boolean;
  asyncRetain: boolean;
}): void {
  const prefix = input.dryRun ? "[dry-run] " : "";
  const { prepared } = input;

  console.log(`${prefix}Seed for bank "${prepared.bankId}"`);
  console.log(`${prefix}Hindsight: ${input.baseUrl}`);
  console.log(`${prefix}Project root: ${prepared.projectRoot}`);
  if (prepared.commit) {
    console.log(`${prefix}Commit: ${prepared.commit}`);
  }
  if (!input.dryRun && input.asyncRetain) {
    console.log(`${prefix}Mode: async`);
  }
  console.log("");

  if (prepared.sources.length === 0) {
    console.log("No durable sources found.");
    console.log(
      "Looked for README.md, docs/**, and ADR files. Add project docs, then re-run.",
    );
    return;
  }

  const actionable = prepared.sources.filter(
    (s) => !s.unchanged && s.facts.length > 0,
  );
  const unchanged = prepared.sources.filter((s) => s.unchanged);
  const empty = prepared.sources.filter(
    (s) => !s.unchanged && s.facts.length === 0,
  );

  if (actionable.length > 0) {
    console.log(
      `${prefix}${input.dryRun ? "Would retain" : "Will retain"} ${prepared.factsToRetain.length} candidate(s) from ${actionable.length} source(s):\n`,
    );
    for (const source of actionable) {
      console.log(`  ${source.relativePath} (${source.facts.length} fact(s))`);
      for (const fact of source.facts) {
        console.log(
          `    - [${fact.bankKind?.id ?? fact.knowledgeKind} score=${fact.score}] ${fact.title}`,
        );
        console.log(`      id: ${fact.id}`);
        const excerpt = fact.content.replace(/\s+/g, " ").trim().slice(0, 100);
        console.log(`      excerpt: ${excerpt}`);
        for (const link of fact.observationLinks ?? []) {
          console.log(`      ${link.relation}: ${link.observationId}`);
        }
      }
      console.log("");
    }
  } else {
    console.log(`${prefix}No new candidates to retain.\n`);
  }

  if (unchanged.length > 0) {
    console.log(
      `${prefix}Skipped ${unchanged.length} unchanged source(s) (use --force to re-seed):`,
    );
    for (const source of unchanged) {
      console.log(`  ${source.relativePath}`);
    }
    console.log("");
  }

  if (prepared.skippedTombstoned > 0) {
    console.log(
      `${prefix}Skipped ${prepared.skippedTombstoned} tombstoned fact(s) (use --force or change the source to retain again).`,
    );
    console.log("");
  }

  if (empty.length > 0) {
    console.log(
      `${prefix}Skipped ${empty.length} source(s) with no high-signal sections:`,
    );
    for (const source of empty) {
      console.log(
        `  ${source.relativePath}${source.skipReason ? ` — ${source.skipReason}` : ""}`,
      );
    }
    console.log("");
  }
}

function resolveObservationRecall(input: {
  options: SeedOptions;
  baseUrl: string;
  apiKey: string | undefined;
}):
  | ((bankId: string, query: string) => Promise<readonly RecalledObservation[]>)
  | undefined {
  if (input.options.recallObservations !== undefined) {
    return input.options.recallObservations;
  }
  const client = input.options.client;
  if (client !== undefined && typeof client.recallObservations === "function") {
    return (bankId, query) => client.recallObservations(bankId, query);
  }
  if (client !== undefined) {
    return undefined;
  }
  const reader = new HindsightClient({
    baseUrl: input.baseUrl,
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
  });
  return (bankId, query) => reader.recallObservations(bankId, query);
}

export async function runSeedCommand(options: SeedOptions = {}): Promise<void> {
  const result = await runSeed(options);
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}
