import { homedir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";

export const CaptainProjectEntrySchema = z.object({
  bankId: z.string().min(1),
  hindsightBaseUrl: z.string().url().optional(),
});

export const CaptainRegistrySchema = z.object({
  projects: z.record(CaptainProjectEntrySchema).default({}),
});

export type CaptainProjectEntry = z.infer<typeof CaptainProjectEntrySchema>;
export type CaptainRegistry = z.infer<typeof CaptainRegistrySchema>;

/**
 * Firstmate's home for this machine: $FM_HOME when set, else the product
 * repo falls back to ~/.nocciolo/projects.json so the mapping still has
 * somewhere durable to live. Nocciolo never invents FM_HOME; it only reads
 * the env var Firstmate sets.
 */
export function captainHomeDir(): string | undefined {
  const fmHome = process.env.FM_HOME;
  return fmHome && fmHome.trim().length > 0 ? fmHome : undefined;
}

export function captainRegistryPath(): string {
  const fmHome = captainHomeDir();
  const base = fmHome ?? homedir();
  return join(base, ".nocciolo", "projects.json");
}

export async function loadCaptainRegistry(): Promise<CaptainRegistry> {
  const path = captainRegistryPath();
  if (!(await pathExists(path))) {
    return { projects: {} };
  }
  const raw = await readJsonFile<unknown>(path);
  const parsed = CaptainRegistrySchema.safeParse(raw);
  return parsed.success ? parsed.data : { projects: {} };
}

export async function saveCaptainRegistryEntry(
  projectRoot: string,
  entry: CaptainProjectEntry,
  dryRun: boolean,
): Promise<{ path: string; wrote: boolean }> {
  const path = captainRegistryPath();
  const registry = await loadCaptainRegistry();
  registry.projects[projectRoot] = entry;

  if (!dryRun) {
    await ensureDir(join(path, ".."));
  }
  await writeJsonFile(path, registry, dryRun);

  return { path, wrote: !dryRun };
}

/**
 * Matches a disposable worktree to its durable clone entry in the captain
 * registry by directory basename (repo name) — worktree pool paths keep the
 * repo's own name as their last path segment, so this is a reliable, cheap
 * heuristic without needing the worktree to carry any Nocciolo state itself.
 */
export function findDurableProjectForWorktree(
  worktreeRoot: string,
  registry: CaptainRegistry,
): { path: string; entry: CaptainProjectEntry } | undefined {
  const repoName = basename(worktreeRoot);
  for (const [path, entry] of Object.entries(registry.projects)) {
    if (basename(path) === repoName) {
      return { path, entry };
    }
  }
  return undefined;
}
