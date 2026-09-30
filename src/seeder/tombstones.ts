import { join } from "node:path";
import { z } from "zod";
import { noccioloDir } from "../config/paths.js";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";

export const TombstoneEntrySchema = z.object({
  sourcePath: z.string().optional(),
  contentHash: z.string().optional(),
  prunedAt: z.string(),
});

export const TombstonesSchema = z.object({
  version: z.literal(1),
  bankId: z.string(),
  updatedAt: z.string(),
  entries: z.record(TombstoneEntrySchema),
});

export type TombstoneEntry = z.infer<typeof TombstoneEntrySchema>;
export type Tombstones = z.infer<typeof TombstonesSchema>;

export function tombstonesPath(projectRoot: string): string {
  return join(noccioloDir(projectRoot), "local", "tombstones.json");
}

export function createEmptyTombstones(bankId: string): Tombstones {
  return {
    version: 1,
    bankId,
    updatedAt: new Date().toISOString(),
    entries: {},
  };
}

export async function loadTombstones(
  projectRoot: string,
): Promise<Tombstones | undefined> {
  const path = tombstonesPath(projectRoot);
  if (!(await pathExists(path))) {
    return undefined;
  }
  const raw = await readJsonFile<unknown>(path);
  const parsed = TombstonesSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export async function saveTombstones(
  projectRoot: string,
  tombstones: Tombstones,
): Promise<void> {
  const path = tombstonesPath(projectRoot);
  await ensureDir(join(noccioloDir(projectRoot), "local"));
  await writeJsonFile(path, tombstones, false);
}

export function isTombstoned(
  documentId: string,
  contentHash: string,
  tombstones: Tombstones | undefined,
  force: boolean,
): boolean {
  if (force || tombstones === undefined) {
    return false;
  }
  const entry = tombstones.entries[documentId];
  if (entry === undefined) {
    return false;
  }
  if (entry.contentHash === undefined) {
    return true;
  }
  return entry.contentHash === contentHash;
}

export function filterTombstonedFacts<T extends { id: string }>(
  facts: T[],
  contentHash: string,
  tombstones: Tombstones | undefined,
  force: boolean,
): { kept: T[]; skipped: number } {
  const kept: T[] = [];
  let skipped = 0;
  for (const fact of facts) {
    if (isTombstoned(fact.id, contentHash, tombstones, force)) {
      skipped += 1;
      continue;
    }
    kept.push(fact);
  }
  return { kept, skipped };
}

export async function addTombstones(
  projectRoot: string,
  bankId: string,
  entries: Array<{
    documentId: string;
    sourcePath?: string;
    contentHash?: string;
  }>,
): Promise<Tombstones> {
  const previous =
    (await loadTombstones(projectRoot)) ?? createEmptyTombstones(bankId);
  const nextEntries = {
    ...(previous.bankId === bankId ? previous.entries : {}),
  };
  const now = new Date().toISOString();
  for (const entry of entries) {
    const record: TombstoneEntry = { prunedAt: now };
    if (entry.sourcePath !== undefined) {
      record.sourcePath = entry.sourcePath;
    }
    if (entry.contentHash !== undefined) {
      record.contentHash = entry.contentHash;
    }
    nextEntries[entry.documentId] = record;
  }
  const next: Tombstones = {
    version: 1,
    bankId,
    updatedAt: now,
    entries: nextEntries,
  };
  await saveTombstones(projectRoot, next);
  return next;
}

export async function clearTombstonesForIds(
  projectRoot: string,
  documentIds: Iterable<string>,
): Promise<void> {
  const previous = await loadTombstones(projectRoot);
  if (previous === undefined) {
    return;
  }
  let changed = false;
  const entries = { ...previous.entries };
  for (const id of documentIds) {
    if (entries[id] !== undefined) {
      delete entries[id];
      changed = true;
    }
  }
  if (!changed) {
    return;
  }
  await saveTombstones(projectRoot, {
    ...previous,
    updatedAt: new Date().toISOString(),
    entries,
  });
}
