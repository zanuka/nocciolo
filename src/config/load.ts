import { NoccioloError } from "../utils/errors.js";
import { pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";
import { configPath, sharePath } from "./paths.js";
import {
  ShareConfig,
  ShareConfigSchema,
  validateShareConfig,
} from "./profiles.js";
import { NoccioloConfig, NoccioloConfigSchema } from "./schema.js";

export async function loadConfig(projectRoot: string): Promise<NoccioloConfig> {
  const path = configPath(projectRoot);
  if (!(await pathExists(path))) {
    throw new NoccioloError(
      `No Nocciolo config found at ${path}`,
      "Run `nocciolo init` from your project root first.",
    );
  }

  const raw = await readJsonFile<unknown>(path);
  const parsed = NoccioloConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new NoccioloError(
      `Invalid config at ${path}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      "Fix the config or re-run `nocciolo init --force`.",
    );
  }
  return parsed.data;
}

export async function saveConfig(
  projectRoot: string,
  config: NoccioloConfig,
  dryRun: boolean,
): Promise<void> {
  await writeJsonFile(configPath(projectRoot), config, dryRun);
}

export async function configExists(projectRoot: string): Promise<boolean> {
  return pathExists(configPath(projectRoot));
}

export async function loadShareConfig(
  projectRoot: string,
): Promise<ShareConfig | null> {
  const path = sharePath(projectRoot);
  if (!(await pathExists(path))) {
    return null;
  }

  const raw = await readJsonFile<unknown>(path);
  const parsed = ShareConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new NoccioloError(
      `Invalid share config at ${path}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      "Fix the file or re-run `nocciolo share --profile <profile>`.",
    );
  }
  validateShareConfig(parsed.data);
  return parsed.data;
}

export async function saveShareConfig(
  projectRoot: string,
  share: ShareConfig,
  dryRun: boolean,
): Promise<void> {
  validateShareConfig(share);
  await writeJsonFile(sharePath(projectRoot), share, dryRun);
}

export async function shareConfigExists(projectRoot: string): Promise<boolean> {
  return pathExists(sharePath(projectRoot));
}
