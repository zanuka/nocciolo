import { loadConfig } from "../config/load.js";
import { bankTemplatePath, hindsightDir } from "../config/paths.js";
import { detectProjectRoot } from "../project/detect-root.js";
import { generateHindsightBankTemplate } from "../providers/hindsight/template.js";
import type { HindsightBankTemplate } from "../providers/hindsight/types.js";
import { NoccioloError } from "../utils/errors.js";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";
import {
  printBankApplyResult,
  runBankApply,
  type BankApplyResult,
} from "./bank.js";
import {
  resolveBankTemplateInput,
  type ConfigureWizardFlags,
} from "./configure-wizard.js";

export interface ConfigureOptions extends ConfigureWizardFlags {
  cwd?: string;
  dryRun?: boolean;
  force?: boolean;
  apply?: boolean;
  hindsightUrl?: string;
  apiKey?: string;
}

export interface ConfigureResult {
  projectRoot: string;
  bankId: string;
  templatePath: string;
  template: HindsightBankTemplate;
  dryRun: boolean;
  wrote: boolean;
  apply?: BankApplyResult;
}

export async function runConfigure(
  options: ConfigureOptions = {},
): Promise<ConfigureResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const apply = options.apply ?? false;

  const projectRoot = await detectProjectRoot(cwd);
  const config = await loadConfig(projectRoot);
  const templatePath = bankTemplatePath(projectRoot);
  const exists = await pathExists(templatePath);

  let template: HindsightBankTemplate;
  let wrote = false;

  if (apply && exists && !force) {
    template = await readJsonFile<HindsightBankTemplate>(templatePath);
  } else {
    if (exists && !force && !dryRun) {
      throw new NoccioloError(
        `Bank template already exists at ${templatePath}`,
        "Use --force to overwrite, `nocciolo configure --apply` to apply the existing template, or `nocciolo configure --dry-run` to preview.",
      );
    }

    let templateInput;
    try {
      templateInput = await resolveBankTemplateInput({
        projectName: config.name,
        bankId: config.bankId,
        flags: {
          ...(options.yes !== undefined ? { yes: options.yes } : {}),
          dryRun,
          ...(options.models !== undefined ? { models: options.models } : {}),
          ...(options.taggingMode !== undefined
            ? { taggingMode: options.taggingMode }
            : {}),
          ...(options.refreshPolicy !== undefined
            ? { refreshPolicy: options.refreshPolicy }
            : {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NoccioloError(message, "Fix the flags or re-run configure.");
    }

    template = generateHindsightBankTemplate(templateInput);

    if (!dryRun) {
      await ensureDir(hindsightDir(projectRoot));
    }
    await writeJsonFile(templatePath, template, dryRun);
    wrote = !dryRun;
  }

  let applyResult: BankApplyResult | undefined;
  if (apply) {
    applyResult = await runBankApply({
      cwd: projectRoot,
      dryRun,
      ...(options.hindsightUrl !== undefined
        ? { hindsightUrl: options.hindsightUrl }
        : {}),
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
    });
  }

  return {
    projectRoot,
    bankId: config.bankId,
    templatePath,
    template,
    dryRun,
    wrote,
    ...(applyResult !== undefined ? { apply: applyResult } : {}),
  };
}

export function printConfigureResult(result: ConfigureResult): void {
  const prefix = result.dryRun ? "[dry-run] " : "";

  if (result.wrote) {
    console.log(`${prefix}Wrote bank template for bank "${result.bankId}"`);
    console.log(`${prefix}Path: ${result.templatePath}`);
    console.log(
      `Extraction mode: ${result.template.bank.retain_extraction_mode}; observations: ${result.template.bank.enable_observations ? "on" : "off"}`,
    );
    console.log(
      `Mental models: ${result.template.mental_models.length}, directives: ${result.template.directives.length}`,
    );
    for (const model of result.template.mental_models) {
      const refresh = model.trigger.refresh_after_consolidation
        ? "auto"
        : "manual";
      const tags = model.tags.length > 0 ? model.tags.join(",") : "(none)";
      const match = model.trigger.tags_match
        ? ` tags_match=${model.trigger.tags_match}`
        : "";
      console.log(
        `  - ${model.id}: refresh=${refresh}; tags=${tags}${match}`,
      );
    }
  } else if (result.dryRun && !result.apply) {
    console.log(`${prefix}Would write bank template for bank "${result.bankId}"`);
    console.log(`${prefix}Path: ${result.templatePath}`);
    console.log(JSON.stringify(result.template, null, 2));
    console.log("No files were written.");
  } else if (result.apply) {
    console.log(`${prefix}Using existing bank template at ${result.templatePath}`);
  }

  if (result.apply) {
    console.log("");
    printBankApplyResult(result.apply);
    return;
  }

  console.log(
    "Next: run `nocciolo bank apply --dry-run` (or `configure --apply`) then `nocciolo seed --dry-run`.",
  );
  console.log(
    "After seed, refresh models with `nocciolo mental-model refresh --all` or `seed --refresh-mental-models`.",
  );
}
