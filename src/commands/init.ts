import { configExists, saveConfig } from "../config/load.js";
import { configPath, ortoDir } from "../config/paths.js";
import {
  createDefaultConfig,
  defaultVolumeName,
  normalizeResourceName,
  slugify,
} from "../config/schema.js";
import {
  defaultProjectName,
  detectProjectRoot,
} from "../project/detect-root.js";
import { OrtoError } from "../utils/errors.js";
import { ensureDir } from "../utils/fs.js";
import { isInteractive, promptLine } from "../utils/prompt.js";
import {
  DEFAULT_CONTAINER_NAME,
} from "../docker/hindsight.js";

export interface InitOptions {
  cwd?: string;
  dryRun?: boolean;
  force?: boolean;
  name?: string;
  bankId?: string;
  containerName?: string;
  yes?: boolean;
}

export interface InitResult {
  projectRoot: string;
  configPath: string;
  bankId: string;
  containerName: string;
  volumeName: string;
  created: boolean;
  dryRun: boolean;
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const yes = options.yes ?? false;

  const projectRoot = await detectProjectRoot(cwd);
  const dir = ortoDir(projectRoot);
  const path = configPath(projectRoot);
  const exists = await configExists(projectRoot);

  if (exists && !force) {
    throw new OrtoError(
      `Orto is already initialized at ${path}`,
      "Use --force to overwrite, or run `orto configure` next.",
    );
  }

  const projectName = options.name ?? defaultProjectName(projectRoot);
  const defaultBankId = slugify(projectName);
  const shouldPrompt =
    !yes &&
    !dryRun &&
    isInteractive() &&
    (options.bankId === undefined || options.containerName === undefined);

  let bankId = options.bankId ?? defaultBankId;
  let containerName = options.containerName ?? DEFAULT_CONTAINER_NAME;

  if (shouldPrompt) {
    if (options.bankId === undefined) {
      const answer = await promptLine(
        "Hindsight bank id (one bank per project; many banks can share one server)",
        { defaultValue: defaultBankId },
      );
      bankId = answer.length > 0 ? answer : defaultBankId;
    }
    if (options.containerName === undefined) {
      const answer = await promptLine(
        "Local Hindsight Docker container name (shared server for one or more banks)",
        { defaultValue: DEFAULT_CONTAINER_NAME },
      );
      containerName =
        answer.length > 0 ? answer : DEFAULT_CONTAINER_NAME;
    }
  }

  bankId = normalizeResourceName(bankId);
  containerName = normalizeResourceName(containerName);
  const volumeName = defaultVolumeName(containerName);

  const config = createDefaultConfig({
    name: projectName,
    root: ".",
    bankId,
    docker: {
      containerName,
      volumeName,
    },
  });

  if (!dryRun) {
    await ensureDir(dir);
  }

  await saveConfig(projectRoot, config, dryRun);

  return {
    projectRoot,
    configPath: path,
    bankId,
    containerName,
    volumeName,
    created: !exists || force,
    dryRun,
  };
}

export function printInitResult(result: InitResult): void {
  const prefix = result.dryRun ? "[dry-run] " : "";
  console.log(`${prefix}Initialized Orto in ${result.projectRoot}`);
  console.log(`${prefix}Config: ${result.configPath}`);
  console.log(`${prefix}Bank id: ${result.bankId}`);
  console.log(
    `${prefix}Docker: container "${result.containerName}", volume "${result.volumeName}"`,
  );
  if (result.dryRun) {
    console.log("No files were written.");
  } else {
    console.log(
      "Next: run `orto configure` to generate a Hindsight bank template.",
    );
  }
}
