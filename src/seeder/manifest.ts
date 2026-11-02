import { join } from "node:path";
import { z } from "zod";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";
import { noccioloDir } from "../config/paths.js";

export const SeedManifestSchema = z.object({
  version: z.literal(1),
  bankId: z.string(),
  updatedAt: z.string(),
  sources: z.record(
    z.object({
      contentHash: z.string(),
      factIds: z.array(z.string()),
      pendingFactIds: z.array(z.string()).optional(),
      seededAt: z.string(),
    }),
  ),
});

export type SeedManifest = z.infer<typeof SeedManifestSchema>;

export function seedManifestPath(projectRoot: string): string {
  return join(noccioloDir(projectRoot), "local", "seed-manifest.json");
}

export async function loadSeedManifest(
  projectRoot: string,
): Promise<SeedManifest | undefined> {
  const path = seedManifestPath(projectRoot);
  if (!(await pathExists(path))) {
    return undefined;
  }
  const raw = await readJsonFile<unknown>(path);
  const parsed = SeedManifestSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export async function saveSeedManifest(
  projectRoot: string,
  manifest: SeedManifest,
): Promise<void> {
  const path = seedManifestPath(projectRoot);
  await ensureDir(join(noccioloDir(projectRoot), "local"));
  await writeJsonFile(path, manifest, false);
}

export function createEmptyManifest(bankId: string): SeedManifest {
  return {
    version: 1,
    bankId,
    updatedAt: new Date().toISOString(),
    sources: {},
  };
}
