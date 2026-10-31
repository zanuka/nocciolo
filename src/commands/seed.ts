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
  formatCitationLines,
  formatRelevanceLines,
  formatSecretSkipWarning,
  judgeSectionCitation,
  judgeSeedRelevance,
  keptCitationText,
  observationRecallQuery,
  recalledToOverlaps,
  type Judge,
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
  extractFacts?: (fact: CandidateFact) => Promise<readonly string[]>;
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
  let citationPreviewed = false;
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
    if (prepared.factsToRetain.length > 0) {
      const extract = resolveFactExtract({
        options,
        baseUrl,
        apiKey,
        bankId: config.bankId,
      });
      if (extract !== undefined) {
        const cited = await applyCitationGate({
          prepared,
          extract,
          judge: resolved.judge,
          confidence: resolved.confidence,
          dryRun,
        });
        prepared = cited.prepared;
        citationPreviewed = cited.previewed;
        if (relevance !== undefined) {
          relevance.settleEmptyPaths.push(...cited.settleEmptyPaths);
          relevance.reopenPaths.push(...cited.reopenPaths);
        }
        for (const line of cited.lines) {
          console.log(line);
        }
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
    if (citationPreviewed) {
      console.log(
        "Extracted facts were previewed (read-only). Nothing was written.",
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

function resolveFactExtract(input: {
  options: SeedOptions;
  baseUrl: string;
  apiKey: string | undefined;
  bankId: string;
}): ((fact: CandidateFact) => Promise<readonly string[]>) | undefined {
  if (input.options.extractFacts !== undefined) {
    return input.options.extractFacts;
  }
  const client = input.options.client;
  const contextFor = (fact: CandidateFact): string =>
    `durable project docs (${fact.provenance.kind}): ${fact.provenance.sourcePath}`;
  if (client !== undefined && typeof client.dryRunExtract === "function") {
    return (fact) =>
      client.dryRunExtract(input.bankId, {
        content: fact.content,
        context: contextFor(fact),
      });
  }
  if (client !== undefined) {
    return undefined;
  }
  const reader = new HindsightClient({
    baseUrl: input.baseUrl,
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
  });
  return (fact) =>
    reader.dryRunExtract(input.bankId, {
      content: fact.content,
      context: contextFor(fact),
    });
}

async function applyCitationGate(input: {
  prepared: PreparedSeed;
  extract: (fact: CandidateFact) => Promise<readonly string[]>;
  judge: Judge;
  confidence: number;
  dryRun: boolean;
}): Promise<{
  prepared: PreparedSeed;
  lines: string[];
  settleEmptyPaths: string[];
  reopenPaths: string[];
  previewed: boolean;
}> {
  const updates = new Map<
    string,
    { drop: boolean; review: boolean; fact?: CandidateFact }
  >();
  const lines: string[] = [];
  let previewed = false;
  let warnedExtract = false;
  let warnedFallback = false;
  const prefix = input.dryRun ? "[dry-run] " : "";

  for (const fact of input.prepared.factsToRetain) {
    let texts: readonly string[];
    try {
      texts = await input.extract(fact);
      previewed = true;
    } catch {
      if (!warnedExtract) {
        console.log(
          "Warning: citation check skipped because dry-run extract failed. Sections are retained as written.",
        );
        warnedExtract = true;
      }
      continue;
    }
    const cleaned = texts.map((text) => text.trim()).filter((text) => text !== "");
    if (cleaned.length === 0) {
      lines.push(
        `${prefix}citation ${fact.id}: no extracted facts; section retained as written.`,
      );
      continue;
    }
    let judged;
    try {
      judged = await judgeSectionCitation({
        path: fact.provenance.sourcePath,
        section: fact.content,
        facts: cleaned,
        judge: input.judge,
        confidence: input.confidence,
      });
    } catch {
      if (!warnedExtract) {
        console.log(
          "Warning: citation check skipped because the judge refused the section. The section is retained as written.",
        );
        warnedExtract = true;
      }
      continue;
    }
    if (judged.fellBack) {
      if (!warnedFallback) {
        console.log(
          "Warning: citation check did not return Jev scores. Sections are retained as written.",
        );
        warnedFallback = true;
      }
      continue;
    }
    lines.push(
      ...formatCitationLines({
        factId: fact.id,
        decisions: judged.decisions,
        dryRun: input.dryRun,
        calls: judged.calls,
      }),
    );
    const kept = keptCitationText(judged.decisions);
    const review = judged.decisions.some((decision) => decision.verdict === "review");
    if (kept === undefined) {
      updates.set(fact.id, { drop: true, review });
      continue;
    }
    updates.set(fact.id, {
      drop: false,
      review,
      fact: { ...fact, content: kept },
    });
  }

  if (updates.size === 0) {
    return {
      prepared: input.prepared,
      lines,
      settleEmptyPaths: [],
      reopenPaths: [],
      previewed,
    };
  }

  const reviewPaths = new Set<string>();
  for (const fact of input.prepared.factsToRetain) {
    const update = updates.get(fact.id);
    if (update?.review === true) {
      reviewPaths.add(fact.provenance.sourcePath);
    }
  }

  const settleEmptyPaths: string[] = [];
  const sources = input.prepared.sources.map((source) => {
    if (!source.facts.some((fact) => updates.has(fact.id))) {
      return source;
    }
    const facts = source.facts.flatMap((fact) => {
      const update = updates.get(fact.id);
      if (update === undefined) {
        return [fact];
      }
      if (update.drop || update.fact === undefined) {
        return [];
      }
      return [update.fact];
    });
    const review = reviewPaths.has(source.relativePath);
    if (!review && facts.length === 0) {
      settleEmptyPaths.push(source.relativePath);
    }
    const next: PreparedSeed["sources"][number] = {
      ...source,
      facts,
      skipped: facts.length === 0,
    };
    if (facts.length === 0) {
      next.skipReason = review
        ? "citation held every extracted fact for review"
        : "citation dropped every extracted fact";
    } else {
      delete next.skipReason;
    }
    return next;
  });

  return {
    prepared: {
      ...input.prepared,
      sources,
      factsToRetain: input.prepared.factsToRetain.flatMap((fact) => {
        const update = updates.get(fact.id);
        if (update === undefined) {
          return [fact];
        }
        if (update.drop || update.fact === undefined) {
          return [];
        }
        return [update.fact];
      }),
    },
    lines,
    settleEmptyPaths,
    reopenPaths: [...reviewPaths],
    previewed,
  };
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
