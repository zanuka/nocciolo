import { OrtoError } from "../utils/errors.js";
import { pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";
import { configPath, sharePath } from "./paths.js";
import {
  ShareConfig,
  ShareConfigSchema,
  validateShareConfig,
} from "./profiles.js";
import { OrtoConfig, OrtoConfigSchema } from "./schema.js";

export async function loadConfig(projectRoot: string): Promise<OrtoConfig> {
  const path = configPath(projectRoot);
  if (!(await pathExists(path))) {
    throw new OrtoError(
      `No Orto config found at ${path}`,
      "Run `orto init` from your project root first.",
    );
  }

  const raw = await readJsonFile<unknown>(path);
  const parsed = OrtoConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrtoError(
      `Invalid config at ${path}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      "Fix the config or re-run `orto init --force`.",
    );
  }
  return parsed.data;
}

export async function saveConfig(
  projectRoot: string,
  config: OrtoConfig,
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
    throw new OrtoError(
      `Invalid share config at ${path}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      "Fix the file or re-run `orto share --profile <profile>`.",
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
