import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../config/load.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  formatPercent,
  HindsightClient,
  resolveHindsightApiKey,
  resolveHindsightBaseUrl,
  type RetainItem,
} from "../providers/hindsight/client.js";
import { formatOperationProgressLine } from "../providers/hindsight/progress.js";
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
import { formatError, isAuthError } from "../utils/errors.js";

export interface SeedOptions {
  cwd?: string;
  dryRun?: boolean;
  force?: boolean;
  hindsightUrl?: string;
  apiKey?: string;
  async?: boolean;
}

export interface SeedResult {
  prepared: PreparedSeed;
  baseUrl: string;
  dryRun: boolean;
  retained: number;
  async: boolean;
  failed: number;
}

export async function runSeed(options: SeedOptions = {}): Promise<SeedResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const asyncRetain = options.async ?? false;

  const projectRoot = await detectProjectRoot(cwd);
  const config = await loadConfig(projectRoot);
  const baseUrl = resolveHindsightBaseUrl({
    ...(options.hindsightUrl !== undefined
      ? { cliUrl: options.hindsightUrl }
      : {}),
    ...(config.hindsightBaseUrl !== undefined
      ? { configUrl: config.hindsightBaseUrl }
      : {}),
  });
  const apiKey = resolveHindsightApiKey({
    ...(options.apiKey !== undefined ? { cliKey: options.apiKey } : {}),
  });

  if (!dryRun && !apiKey) {
    console.log(
      "Warning: no API key resolved (NOCCIOLO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY / --api-key).",
    );
    console.log(
      "If your Hindsight server requires auth, retain will fail with 401.",
    );
    console.log("");
  }
  const prepared = await prepareSeed({
    projectRoot,
    bankId: config.bankId,
    force,
  });

  printSeedPlan({
    prepared,
    baseUrl,
    dryRun,
    asyncRetain,
  });

  if (dryRun) {
    console.log(
      "No memories were retained. Re-run without --dry-run to call Hindsight.",
    );
    return {
      prepared,
      baseUrl,
      dryRun: true,
      retained: 0,
      async: asyncRetain,
      failed: 0,
    };
  }

  if (prepared.factsToRetain.length === 0) {
    console.log("Nothing was sent to Hindsight.");
    return {
      prepared,
      baseUrl,
      dryRun: false,
      retained: 0,
      async: asyncRetain,
      failed: 0,
    };
  }

  const client = new HindsightClient({
    baseUrl,
    ...(apiKey !== undefined ? { apiKey } : {}),
  });
  const { retainedIds, failed } = await retainPreparedItems({
    client,
    bankId: config.bankId,
    items: toRetainItems(prepared.factsToRetain),
    asyncRetain,
    retryHint: "NOCCIOLO_HINDSIGHT_API_KEY='your-key' pnpm nocciolo seed",
  });

  const previous =
    (await loadSeedManifest(projectRoot)) ??
    createEmptyManifest(config.bankId);
  const manifest = nextManifest(
    previous,
    config.bankId,
    prepared,
    retainedIds,
  );
  await saveSeedManifest(projectRoot, manifest);

  console.log("");
  if (retainedIds.size > 0) {
    console.log(
      `Retained ${retainedIds.size} item(s)${asyncRetain ? " (async)" : ""}${failed > 0 ? `, ${failed} failed` : ""}.`,
    );
    console.log(
      "Incremental state saved under .nocciolo/local/seed-manifest.json",
    );
    console.log(
      "Hindsight may still run consolidation in the background — safe to close the terminal after retain finishes.",
    );
  } else {
    console.log("Nothing was successfully retained.");
  }

  return {
    prepared,
    baseUrl,
    dryRun: false,
    retained: retainedIds.size,
    async: asyncRetain,
    failed,
  };
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

function collectOperationIds(response: {
  operation_id?: string;
  operation_ids?: string[];
}): string[] {
  if (response.operation_ids && response.operation_ids.length > 0) {
    return response.operation_ids;
  }
  if (response.operation_id) {
    return [response.operation_id];
  }
  return [];
}

async function pollOperationUntilDone(
  client: HindsightClient,
  bankId: string,
  operationId: string,
): Promise<void> {
  let lastLine = "";
  for (;;) {
    const status = await client.getOperationStatus(bankId, operationId);
    const line = formatOperationProgressLine(operationId, status);
    if (line !== lastLine) {
      console.log(`  ${line}`);
      lastLine = line;
    }

    const state = status.status ?? "";
    if (state === "completed") {
      console.log(`  Operation ${operationId} completed.`);
      return;
    }
    if (state === "failed" || state === "cancelled") {
      throw new Error(
        `Hindsight operation ${operationId} ${state}${status.error_message ? `: ${status.error_message}` : ""}`,
      );
    }

    await delay(2000);
  }
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
      "Looked for README.md, AGENTS.md, docs/**, and ADR files. Add project docs, then re-run.",
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
          `    - [${fact.knowledgeKind} score=${fact.score}] ${fact.title}`,
        );
        console.log(`      id: ${fact.id}`);
        const excerpt = fact.content.replace(/\s+/g, " ").trim().slice(0, 100);
        console.log(`      excerpt: ${excerpt}`);
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

export async function runSeedCommand(options: SeedOptions = {}): Promise<void> {
  const result = await runSeed(options);
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}
