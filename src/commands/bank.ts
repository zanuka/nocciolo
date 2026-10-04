import { loadConfig, loadShareConfig } from "../config/load.js";
import {
  assertApiKeyForConnection,
  resolveProjectConnection,
} from "../config/connection.js";
import { bankTemplatePath } from "../config/paths.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  HindsightClient,
  resolveHindsightApiKey,
} from "../providers/hindsight/client.js";
import { applyBankTemplate } from "../providers/hindsight/apply.js";
import type { HindsightBankTemplate } from "../providers/hindsight/types.js";
import { NoccioloError } from "../utils/errors.js";
import { pathExists, readJsonFile } from "../utils/fs.js";

export interface BankApplyOptions {
  cwd?: string;
  dryRun?: boolean;
  hindsightUrl?: string;
  apiKey?: string;
}

export interface BankApplyResult {
  projectRoot: string;
  bankId: string;
  baseUrl: string;
  templatePath: string;
  dryRun: boolean;
  steps: Array<{ kind: string; id: string; action: string; detail?: string }>;
}

export async function runBankApply(
  options: BankApplyOptions = {},
): Promise<BankApplyResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
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
  const apiKey = resolveHindsightApiKey({
    ...(options.apiKey !== undefined ? { cliKey: options.apiKey } : {}),
  });
  assertApiKeyForConnection({ connection, ...(apiKey ? { apiKey } : {}) });

  const templatePath = bankTemplatePath(projectRoot);
  if (!(await pathExists(templatePath))) {
    throw new NoccioloError(
      `Bank template not found at ${templatePath}`,
      "Run `nocciolo configure` first to generate `.nocciolo/hindsight/bank-template.json`.",
    );
  }

  const template = await readJsonFile<HindsightBankTemplate>(templatePath);
  if (template.version !== "1" || !template.bank) {
    throw new NoccioloError(
      `Unsupported or invalid bank template at ${templatePath}`,
      "Re-run `nocciolo configure --force` to regenerate a version \"1\" template.",
    );
  }

  const client = new HindsightClient({
    baseUrl: connection.baseUrl,
    ...(apiKey !== undefined ? { apiKey } : {}),
  });

  const applied = await applyBankTemplate({
    client,
    bankId: config.bankId,
    projectName: config.name,
    template,
    dryRun,
  });

  return {
    projectRoot,
    bankId: config.bankId,
    baseUrl: connection.baseUrl,
    templatePath,
    dryRun,
    steps: applied.steps,
  };
}

export function printBankApplyResult(result: BankApplyResult): void {
  const prefix = result.dryRun ? "[dry-run] " : "";
  console.log(`${prefix}Bank apply for "${result.bankId}"`);
  console.log(`${prefix}Hindsight: ${result.baseUrl}`);
  console.log(`${prefix}Template:  ${result.templatePath}`);
  console.log("");
  for (const step of result.steps) {
    const detail = step.detail ? ` (${step.detail})` : "";
    console.log(
      `${prefix}${step.action.padEnd(6)} ${step.kind} ${step.id}${detail}`,
    );
  }
  if (result.dryRun) {
    console.log("");
    console.log("No Hindsight mutations were made.");
  } else {
    console.log("");
    console.log(
      "Next: `nocciolo seed --dry-run` then `nocciolo seed` to retain durable docs.",
    );
  }
}
