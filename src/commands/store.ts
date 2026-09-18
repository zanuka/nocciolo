import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { loadConfig, saveConfig } from "../config/load.js";
import { detectProjectRoot } from "../project/detect-root.js";
import { isGitWorktree } from "../project/worktree.js";
import {
  findDurableProjectForWorktree,
  loadCaptainRegistry,
} from "../project/registry.js";
import { hashContent } from "../extractor/hash.js";
import {
  checkStoreDeny,
  relativeToProjectRoot,
} from "../scanner/store-policy.js";
import { findDurableSources } from "../scanner/durable-sources.js";
import {
  HindsightClient,
  resolveHindsightApiKey,
  resolveHindsightBaseUrl,
} from "../providers/hindsight/client.js";
import {
  createEmptyManifest,
  loadSeedManifest,
  saveSeedManifest,
  type SeedManifest,
} from "../seeder/manifest.js";
import { nextManifest, prepareSeed, toRetainItems } from "../seeder/prepare.js";
import { retainPreparedItems } from "./seed.js";
import { NoccioloError } from "../utils/errors.js";
import { isInteractive, promptMultiSelect } from "../utils/prompt.js";

export interface StoreOptions {
  cwd?: string;
  project?: string;
  dryRun?: boolean;
  force?: boolean;
  async?: boolean;
  yes?: boolean;
  files?: string;
  addFiles?: string;
  hindsightUrl?: string;
  apiKey?: string;
}

export interface StoreBucketEntry {
  relativePath: string;
  absolutePath: string;
}

export interface StoreBuckets {
  known: StoreBucketEntry[];
  new: StoreBucketEntry[];
  changed: StoreBucketEntry[];
  unchanged: StoreBucketEntry[];
}

export interface StoreResult {
  projectRoot: string;
  bankId: string;
  baseUrl: string;
  dryRun: boolean;
  buckets: StoreBuckets;
  selected: string[];
  skippedNew: string[];
  addedToAllowlist: string[];
  retained: number;
  failed: number;
  async: boolean;
  addFilesOnly: boolean;
}

function parsePathList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

async function resolveStoreProjectRoot(
  options: StoreOptions,
): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const explicitProject = options.project !== undefined;

  const root = explicitProject
    ? isAbsolute(options.project as string)
      ? (options.project as string)
      : resolve(cwd, options.project as string)
    : await detectProjectRoot(cwd);

  if (!(await isGitWorktree(root))) {
    return root;
  }

  if (explicitProject) {
    throw new NoccioloError(
      `${root} is a disposable git worktree; Nocciolo never stores from a worktree.`,
      "Pass --project pointing at the durable clone that owns .nocciolo/ (firstmate/projects/nocciolo or a daily checkout), not a Treehouse worktree.",
    );
  }

  const registry = await loadCaptainRegistry();
  const durable = findDurableProjectForWorktree(root, registry);
  if (durable) {
    return durable.path;
  }

  throw new NoccioloError(
    `${root} is a disposable git worktree; Nocciolo never stores from a worktree.`,
    "Run `nocciolo store` from the durable clone that owns .nocciolo/, pass --project <durable-clone-path>, or register the durable clone with `nocciolo mcp --harness firstmate --write-firstmate`.",
  );
}

function resolveRelativePath(projectRoot: string, cwd: string, raw: string): string {
  const absolute = isAbsolute(raw) ? raw : resolve(cwd, raw);
  return relativeToProjectRoot(projectRoot, absolute);
}

async function computeBuckets(
  projectRoot: string,
  allowlist: readonly string[],
  manifest: SeedManifest,
): Promise<StoreBuckets> {
  const sources = await findDurableSources(projectRoot);
  const allowSet = new Set(allowlist);
  const buckets: StoreBuckets = {
    known: [],
    new: [],
    changed: [],
    unchanged: [],
  };

  for (const source of sources) {
    const deny = checkStoreDeny(source.relativePath, projectRoot);
    if (deny.denied) {
      continue;
    }

    const entry: StoreBucketEntry = {
      relativePath: source.relativePath,
      absolutePath: source.absolutePath,
    };

    if (!allowSet.has(source.relativePath)) {
      buckets.new.push(entry);
      continue;
    }

    buckets.known.push(entry);
    const content = await readFile(source.absolutePath, "utf8");
    const hash = hashContent(content);
    const previousHash = manifest.sources[source.relativePath]?.contentHash;
    if (previousHash === hash) {
      buckets.unchanged.push(entry);
    } else {
      buckets.changed.push(entry);
    }
  }

  return buckets;
}

export async function runStore(options: StoreOptions = {}): Promise<StoreResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const asyncRetain = options.async ?? false;
  const yes = options.yes ?? false;

  const projectRoot = await resolveStoreProjectRoot(options);
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

  let manifest =
    (await loadSeedManifest(projectRoot)) ?? createEmptyManifest(config.bankId);

  let allowlist = [...(config.store?.allowlist ?? [])];
  if (config.store === undefined && Object.keys(manifest.sources).length > 0) {
    // First store after seed: bootstrap the allowlist from the last seed
    // manifest so already-seeded sources read as "known", not "new".
    allowlist = Object.keys(manifest.sources);
  }

  const explicitFiles = parsePathList(options.files);
  const addFiles = parsePathList(options.addFiles);

  // --add-files: allowlist only, no retain, no scanning of buckets required.
  if (addFiles.length > 0) {
    const toAdd: string[] = [];
    for (const raw of addFiles) {
      const relativePath = resolveRelativePath(projectRoot, cwd, raw);
      const deny = checkStoreDeny(relativePath, projectRoot, { explicit: true });
      if (deny.denied) {
        throw new NoccioloError(
          `Refusing to allowlist "${relativePath}": ${deny.reason}`,
          "Pick a durable markdown file inside the project root.",
        );
      }
      if (!allowlist.includes(relativePath)) {
        toAdd.push(relativePath);
      }
    }
    const nextAllowlist = [...new Set([...allowlist, ...toAdd])].sort();
    await saveConfig(
      projectRoot,
      { ...config, store: { allowlist: nextAllowlist } },
      dryRun,
    );

    const buckets = await computeBuckets(projectRoot, nextAllowlist, manifest);
    printStorePlan({ projectRoot, bankId: config.bankId, baseUrl, dryRun, buckets });
    console.log("");
    console.log(
      `${dryRun ? "[dry-run] Would add" : "Added"} ${toAdd.length} file(s) to store.allowlist (no retain).`,
    );
    for (const path of toAdd) {
      console.log(`  + ${path}`);
    }

    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      dryRun,
      buckets,
      selected: [],
      skippedNew: [],
      addedToAllowlist: toAdd,
      retained: 0,
      failed: 0,
      async: asyncRetain,
      addFilesOnly: true,
    };
  }

  const buckets = await computeBuckets(projectRoot, allowlist, manifest);

  let selected: string[] = [];
  let skippedNew: string[] = [];
  let addedToAllowlist: string[] = [];

  if (explicitFiles.length > 0) {
    const resolved: string[] = [];
    for (const raw of explicitFiles) {
      const relativePath = resolveRelativePath(projectRoot, cwd, raw);
      const deny = checkStoreDeny(relativePath, projectRoot, { explicit: true });
      if (deny.denied) {
        throw new NoccioloError(
          `Refusing to store "${relativePath}": ${deny.reason}`,
          "Pass a durable markdown file inside the project root.",
        );
      }
      resolved.push(relativePath);
    }
    selected = resolved;
    addedToAllowlist = resolved.filter((p) => !allowlist.includes(p));
    allowlist = [...new Set([...allowlist, ...resolved])].sort();
  } else if (yes) {
    selected = buckets.changed.map((b) => b.relativePath);
    skippedNew = buckets.new.map((b) => b.relativePath);
  } else if (isInteractive() && !dryRun) {
    selected = buckets.changed.map((b) => b.relativePath);
    if (buckets.new.length > 0) {
      const picked = await promptMultiSelect(
        "New durable markdown found (not yet in store.allowlist):",
        buckets.new.map((b) => b.relativePath),
      );
      selected = [...selected, ...picked];
      addedToAllowlist = picked;
      allowlist = [...new Set([...allowlist, ...picked])].sort();
      skippedNew = buckets.new
        .map((b) => b.relativePath)
        .filter((p) => !picked.includes(p));
    }
  } else {
    // Non-interactive without --yes/--files (dry-run preview, or no TTY):
    // never silently adopt new files.
    selected = buckets.changed.map((b) => b.relativePath);
    skippedNew = buckets.new.map((b) => b.relativePath);
  }

  const finalBuckets =
    addedToAllowlist.length > 0
      ? await computeBuckets(projectRoot, allowlist, manifest)
      : buckets;

  printStorePlan({
    projectRoot,
    bankId: config.bankId,
    baseUrl,
    dryRun,
    buckets: finalBuckets,
  });

  if (skippedNew.length > 0) {
    console.log("");
    console.log(
      `Skipped ${skippedNew.length} new file(s) (not stored): ${skippedNew.join(", ")}`,
    );
    console.log(
      "Next: `nocciolo store --files <path>[,<path>...]` or run interactively to select them.",
    );
  }

  if (dryRun) {
    console.log("");
    console.log("No memories were retained. Suggested next commands:");
    if (finalBuckets.new.length > 0) {
      console.log(
        `  nocciolo store --files ${finalBuckets.new.map((b) => b.relativePath).join(",")}`,
      );
    }
    if (finalBuckets.changed.length > 0) {
      console.log("  nocciolo store --yes");
    }
    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      dryRun: true,
      buckets: finalBuckets,
      selected,
      skippedNew,
      addedToAllowlist,
      retained: 0,
      failed: 0,
      async: asyncRetain,
      addFilesOnly: false,
    };
  }

  if (addedToAllowlist.length > 0) {
    await saveConfig(projectRoot, { ...config, store: { allowlist } }, false);
  } else if (config.store === undefined) {
    await saveConfig(projectRoot, { ...config, store: { allowlist } }, false);
  }

  if (selected.length === 0) {
    console.log("");
    console.log("Nothing selected to store.");
    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      dryRun: false,
      buckets: finalBuckets,
      selected,
      skippedNew,
      addedToAllowlist,
      retained: 0,
      failed: 0,
      async: asyncRetain,
      addFilesOnly: false,
    };
  }

  const prepared = await prepareSeed({
    projectRoot,
    bankId: config.bankId,
    force,
    only: new Set(selected),
  });

  if (prepared.factsToRetain.length === 0) {
    console.log("");
    console.log("Nothing was sent to Hindsight (no high-signal candidates).");
    return {
      projectRoot,
      bankId: config.bankId,
      baseUrl,
      dryRun: false,
      buckets: finalBuckets,
      selected,
      skippedNew,
      addedToAllowlist,
      retained: 0,
      failed: 0,
      async: asyncRetain,
      addFilesOnly: false,
    };
  }

  if (!apiKey) {
    console.log(
      "Warning: no API key resolved (NOCCIOLO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY / --api-key).",
    );
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
    retryHint: "NOCCIOLO_HINDSIGHT_API_KEY='your-key' pnpm nocciolo store --yes",
  });

  manifest = nextManifest(manifest, config.bankId, prepared, retainedIds);
  await saveSeedManifest(projectRoot, manifest);

  console.log("");
  if (retainedIds.size > 0) {
    console.log(
      `Stored ${retainedIds.size} item(s)${asyncRetain ? " (async)" : ""}${failed > 0 ? `, ${failed} failed` : ""}.`,
    );
    console.log(
      "Incremental state saved under .nocciolo/local/seed-manifest.json",
    );
  } else {
    console.log("Nothing was successfully stored.");
  }

  return {
    projectRoot,
    bankId: config.bankId,
    baseUrl,
    dryRun: false,
    buckets: finalBuckets,
    selected,
    skippedNew,
    addedToAllowlist,
    retained: retainedIds.size,
    failed,
    async: asyncRetain,
    addFilesOnly: false,
  };
}

function printStorePlan(input: {
  projectRoot: string;
  bankId: string;
  baseUrl: string;
  dryRun: boolean;
  buckets: StoreBuckets;
}): void {
  const prefix = input.dryRun ? "[dry-run] " : "";
  console.log(`${prefix}Store for bank "${input.bankId}"`);
  console.log(`${prefix}Hindsight: ${input.baseUrl}`);
  console.log(`${prefix}Project root: ${input.projectRoot}`);
  console.log("");
  console.log(`${prefix}known: ${input.buckets.known.length}`);
  console.log(`${prefix}new: ${input.buckets.new.length}`);
  console.log(`${prefix}changed: ${input.buckets.changed.length}`);
  console.log(`${prefix}unchanged: ${input.buckets.unchanged.length}`);

  if (input.buckets.new.length > 0) {
    console.log("");
    console.log("New (not in store.allowlist):");
    for (const entry of input.buckets.new) {
      console.log(`  ${entry.relativePath}`);
    }
  }
  if (input.buckets.changed.length > 0) {
    console.log("");
    console.log("Changed (allowlisted, content hash differs):");
    for (const entry of input.buckets.changed) {
      console.log(`  ${entry.relativePath}`);
    }
  }
  if (input.buckets.unchanged.length > 0) {
    console.log("");
    console.log("Unchanged (allowlisted, hash matches; skipped):");
    for (const entry of input.buckets.unchanged) {
      console.log(`  ${entry.relativePath}`);
    }
  }
}

export async function runStoreCommand(options: StoreOptions = {}): Promise<void> {
  const result = await runStore(options);
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}
