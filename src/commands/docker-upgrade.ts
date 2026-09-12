import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config/load.js";
import {
  assertDockerAvailable,
  inspectHindsightContainer,
  pullHindsightImage,
  runAdminBackup,
  stopAndRemoveContainer,
  verifyTarballNonEmpty,
  waitForHindsightHealth,
} from "../docker/inspect.js";
import { runDockerCommand } from "../docker/hindsight.js";
import {
  assertNoVolumeDeleteArgv,
  buildBackupPlan,
  buildBackupReadme,
  buildRecreatePlan,
  countPendingOperations,
  defaultBackupDir,
  diffBankFactCounts,
  formatFactCountTable,
  normalizeBankManifest,
  normalizeVersionTag,
  pinnedHindsightImage,
  versionsEqual,
  type BankManifestEntry,
  type FactCountDiffResult,
} from "../docker/upgrade.js";
import { resolveDockerNames } from "./docker.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  HindsightInstanceClient,
} from "../providers/hindsight/instance.js";
import {
  resolveHindsightApiKey,
  resolveHindsightBaseUrl,
} from "../providers/hindsight/client.js";
import { NoccioloError } from "../utils/errors.js";
import { isInteractive, promptLine } from "../utils/prompt.js";

export interface DockerUpgradeOptions {
  to: string;
  dryRun?: boolean;
  backupDir?: string;
  skipBackup?: boolean;
  force?: boolean;
  allBanks?: boolean;
  bank?: string;
  yes?: boolean;
  hindsightUrl?: string;
  apiKey?: string;
  cwd?: string;
  containerName?: string;
  healthTimeoutMs?: number;
}

export interface DockerUpgradeResult {
  dryRun: boolean;
  skipped: boolean;
  skipReason?: string;
  fromVersion: string;
  toVersion: string;
  targetImage: string;
  containerName: string;
  volumeName: string;
  backupDir?: string;
  baseUrl: string;
  banks: BankManifestEntry[];
  validation?: FactCountDiffResult;
  planLines: string[];
}

export async function runDockerUpgrade(
  options: DockerUpgradeOptions,
): Promise<DockerUpgradeResult> {
  const dryRun = options.dryRun ?? false;
  const skipBackup = options.skipBackup ?? false;
  const force = options.force ?? false;
  const yes = options.yes ?? false;
  const toVersion = normalizeVersionTag(options.to);
  const targetImage = pinnedHindsightImage(toVersion);

  const { containerName } = await resolveDockerNames({
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.containerName !== undefined
      ? { containerName: options.containerName }
      : {}),
  });

  let projectBankId = options.bank;
  let configUrl: string | undefined;
  try {
    const projectRoot = await detectProjectRoot(options.cwd ?? process.cwd());
    const config = await loadConfig(projectRoot);
    configUrl = config.hindsightBaseUrl;
    if (projectBankId === undefined) {
      projectBankId = config.bankId;
    }
  } catch {
  }

  const baseUrl = resolveHindsightBaseUrl({
    ...(options.hindsightUrl !== undefined
      ? { cliUrl: options.hindsightUrl }
      : {}),
    ...(configUrl !== undefined ? { configUrl } : {}),
  });
  const apiKey = resolveHindsightApiKey({
    ...(options.apiKey !== undefined ? { cliKey: options.apiKey } : {}),
  });

  if (!dryRun) {
    await assertDockerAvailable();
  }

  const planLines: string[] = [];
  planLines.push(`Target image: ${targetImage}`);
  planLines.push(`Container: ${containerName}`);
  planLines.push(`API: ${baseUrl}`);

  if (dryRun) {
    let volumeName = "(inspect at runtime)";
    let fromVersion = "(unknown until live)";
    let inspectedImage = "(unknown)";
    try {
      await assertDockerAvailable();
      const inspected = await inspectHindsightContainer(containerName);
      volumeName = inspected.pg0VolumeName;
      inspectedImage = inspected.image;
      planLines.push(`Inspected image: ${inspectedImage}`);
      planLines.push(`Inspected volume: ${volumeName} -> /home/hindsight/.pg0`);
      planLines.push(
        `Would preserve ${inspected.env.length} env vars and recreate container in place`,
      );
    } catch (error) {
      planLines.push(
        `Inspect skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const backupDir =
      options.backupDir ??
      defaultBackupDir({ toVersion });
    const backupPlan = buildBackupPlan({
      backupDir,
      volumeName: volumeName === "(inspect at runtime)" ? "hindsight-data" : volumeName,
    });
    planLines.push(`Backup dir: ${backupDir}`);
    if (skipBackup) {
      planLines.push("WARNING: --skip-backup set; would skip required backups");
    } else {
      planLines.push(`Volume tarball: ${backupPlan.volumeTarball.display}`);
      planLines.push(
        "Also: hindsight-admin backup (if available), per-bank stats/export, document-transfer when 200",
      );
    }
    planLines.push(`Pull: docker pull ${targetImage}`);
    planLines.push(`Stop/remove container only: docker rm -f ${containerName}`);
    planLines.push("Recreate with same volume + preserved env (never volume rm)");
    planLines.push("Validate: /version, /health, bank ids + fact_count match manifest");
    if (projectBankId) {
      planLines.push(`Project bank (emphasized): ${projectBankId}`);
    }

    return {
      dryRun: true,
      skipped: false,
      fromVersion,
      toVersion,
      targetImage,
      containerName,
      volumeName,
      backupDir,
      baseUrl,
      banks: [],
      planLines,
    };
  }

  const clientOptions: {
    baseUrl: string;
    apiKey?: string;
  } = { baseUrl };
  if (apiKey !== undefined) {
    clientOptions.apiKey = apiKey;
  }
  const client = new HindsightInstanceClient(clientOptions);

  const versionInfo = await client.getVersion();
  const fromVersion =
    client.resolveApiVersion(versionInfo) ??
    "(unknown)";
  const health = await client.getHealth();
  if (!client.isHealthy(health)) {
    throw new NoccioloError(
      `Hindsight health check failed at ${baseUrl}`,
      `Response: ${JSON.stringify(health)}. Fix health before upgrading.`,
    );
  }

  planLines.push(`Current api_version: ${fromVersion}`);

  if (versionsEqual(fromVersion, toVersion) && !force) {
    return {
      dryRun: false,
      skipped: true,
      skipReason: `Already on target version ${toVersion}`,
      fromVersion,
      toVersion,
      targetImage,
      containerName,
      volumeName: "(unchanged)",
      baseUrl,
      banks: [],
      planLines: [
        ...planLines,
        `Already on ${toVersion}. Pass --force to recreate anyway.`,
      ],
    };
  }

  const banksRaw = await client.listBanks();
  const banks = normalizeBankManifest(banksRaw);
  if (banks.length === 0) {
    planLines.push("Warning: no banks listed on instance");
  }

  const statsList: unknown[] = [];
  for (const bank of banks) {
    try {
      statsList.push(await client.getBankStats(bank.bank_id));
    } catch {
      statsList.push({});
    }
  }
  const pending = countPendingOperations(statsList);
  if (pending > 0) {
    const message = `Detected ${pending} pending/processing operation field(s) across bank stats. Upgrading mid-flight can leave work incomplete.`;
    if (!yes) {
      if (!isInteractive()) {
        throw new NoccioloError(
          message,
          "Re-run with -y/--yes after quiescing retain traffic, or wait for operations to finish.",
        );
      }
      console.warn(`Warning: ${message}`);
      const answer = await promptLine("Continue with upgrade? [y/N]");
      if (!/^y(es)?$/i.test(answer)) {
        throw new NoccioloError(
          "Upgrade aborted due to pending operations",
          "Wait for operations to finish, then re-run. Use -y to skip this confirm.",
        );
      }
    } else {
      console.warn(`Warning: ${message} Continuing because -y was set.`);
    }
  }

  if (!yes) {
    if (!isInteractive()) {
      throw new NoccioloError(
        "Non-interactive upgrade requires -y/--yes",
        "Re-run with -y after reviewing `nocciolo docker upgrade --to <ver> --dry-run`.",
      );
    }
    const answer = await promptLine(
      `Upgrade ${containerName} from ${fromVersion} to ${toVersion}? This recreates the container and keeps the data volume. [y/N]`,
    );
    if (!/^y(es)?$/i.test(answer)) {
      throw new NoccioloError(
        "Upgrade aborted",
        "Re-run with -y to skip confirmation.",
      );
    }
  }

  const inspected = await inspectHindsightContainer(containerName);
  const volumeName = inspected.pg0VolumeName;
  planLines.push(`Volume (from inspect): ${volumeName} -> /home/hindsight/.pg0`);

  let backupDir: string | undefined;
  if (skipBackup) {
    console.warn(
      "WARNING: --skip-backup is set. Skipping required backups. This is dangerous.",
    );
    planLines.push("Backup: SKIPPED (--skip-backup)");
  } else {
    backupDir =
      options.backupDir ??
      defaultBackupDir({ toVersion });
    await mkdir(backupDir, { recursive: true });
    await mkdir(join(backupDir, "banks"), { recursive: true });
    await mkdir(join(backupDir, "document-transfers"), { recursive: true });

    const backupPlan = buildBackupPlan({ backupDir, volumeName });
    planLines.push(`Backup dir: ${backupDir}`);

    await writeFile(
      backupPlan.manifestPath,
      `${JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          fromVersion,
          toVersion,
          containerName,
          volumeName,
          banks,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    for (const bank of banks) {
      const statsPath = join(
        backupPlan.banksDir,
        `${bank.bank_id}-stats.json`,
      );
      try {
        const stats = await client.getBankStats(bank.bank_id);
        await writeFile(
          statsPath,
          `${JSON.stringify(stats, null, 2)}\n`,
          "utf8",
        );
      } catch (error) {
        await writeFile(
          statsPath,
          `${JSON.stringify(
            {
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
      }

      const exportPath = join(
        backupPlan.banksDir,
        `${bank.bank_id}-export.json`,
      );
      try {
        const exported = await client.exportBank(bank.bank_id);
        await writeFile(
          exportPath,
          `${JSON.stringify(exported, null, 2)}\n`,
          "utf8",
        );
      } catch {
      }

      try {
        const transfer = await client.tryDocumentTransfer(bank.bank_id);
        if (transfer.ok) {
          const ext = transfer.contentType.includes("zip") ? "zip" : "bin";
          const transferPath = join(
            backupPlan.documentTransfersDir,
            `${bank.bank_id}-documents.${ext}`,
          );
          await writeFile(transferPath, transfer.bytes);
        }
      } catch {
      }
    }

    const adminOk = await runAdminBackup({
      containerName,
      containerZipPath: `/tmp/hindsight-backup-pre-${toVersion}.zip`,
      hostZipPath: join(backupDir, backupPlan.adminBackupZipName),
    }).catch(() => false);
    if (adminOk) {
      planLines.push("Admin backup: hindsight-admin-backup.zip");
    } else {
      planLines.push(
        "Admin backup: skipped (hindsight-admin unavailable or failed)",
      );
    }

    assertNoVolumeDeleteArgv(backupPlan.volumeTarball.argv);
    await runDockerCommand(backupPlan.volumeTarball.argv);
    const tarballStat = await stat(backupPlan.volumeTarball.hostTarballPath);
    if (tarballStat.size <= 0) {
      throw new NoccioloError(
        `Volume tarball is empty: ${backupPlan.volumeTarball.hostTarballPath}`,
        "Aborting upgrade. Fix Docker volume access and re-run without --skip-backup.",
      );
    }
    const entryCount = await verifyTarballNonEmpty(
      backupPlan.volumeTarball.hostTarballPath,
    );
    planLines.push(
      `Volume tarball: ${backupPlan.volumeTarball.hostTarballPath} (${entryCount} entries)`,
    );

    const readme = buildBackupReadme({
      timestamp: new Date().toISOString(),
      fromVersion,
      toVersion,
      containerName,
      volumeName,
      banks,
      ...(projectBankId !== undefined ? { projectBankId } : {}),
    });
    await writeFile(backupPlan.readmePath, readme, "utf8");
  }

  const recreate = buildRecreatePlan({ inspected, targetImage });
  assertNoVolumeDeleteArgv(recreate.argv);
  assertNoVolumeDeleteArgv(["docker", "rm", "-f", containerName]);

  console.log(`Pulling ${targetImage}…`);
  await pullHindsightImage(targetImage);

  console.log(`Recreating container ${containerName} (volume kept)…`);
  await stopAndRemoveContainer(containerName);
  await runDockerCommand(recreate.argv);

  const waitOptions: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
    containerName: string;
  } = {
    baseUrl,
    containerName,
  };
  if (apiKey !== undefined) {
    waitOptions.apiKey = apiKey;
  }
  if (options.healthTimeoutMs !== undefined) {
    waitOptions.timeoutMs = options.healthTimeoutMs;
  }
  await waitForHindsightHealth(waitOptions);

  const afterVersionInfo = await client.getVersion();
  const afterVersion = client.resolveApiVersion(afterVersionInfo);
  if (!afterVersion || !versionsEqual(afterVersion, toVersion)) {
    throw new NoccioloError(
      `Post-upgrade /version mismatch: expected ${toVersion}, got ${afterVersion ?? "unknown"}`,
      backupDir
        ? `Backup is at ${backupDir}. See docs/hindsight-upgrade.md for rollback.`
        : "See docs/hindsight-upgrade.md for rollback.",
    );
  }

  const afterHealth = await client.getHealth();
  if (!client.isHealthy(afterHealth)) {
    throw new NoccioloError(
      "Post-upgrade health check failed",
      backupDir
        ? `Backup is at ${backupDir}. Check docker logs and docs/hindsight-upgrade.md.`
        : "Check docker logs and docs/hindsight-upgrade.md.",
    );
  }

  const afterBanks = normalizeBankManifest(await client.listBanks());
  const validation = diffBankFactCounts(banks, afterBanks);
  if (!validation.ok) {
    throw new NoccioloError(
      "Post-upgrade bank validation failed (bank set or fact_count mismatch)",
      [
        formatFactCountTable(validation.rows),
        backupDir
          ? `Backup path: ${backupDir}`
          : "No backup was taken (--skip-backup).",
        "See docs/hindsight-bank-backup.md and docs/hindsight-upgrade.md for restore.",
      ].join("\n"),
    );
  }

  return {
    dryRun: false,
    skipped: false,
    fromVersion,
    toVersion,
    targetImage,
    containerName,
    volumeName,
    ...(backupDir !== undefined ? { backupDir } : {}),
    baseUrl,
    banks,
    validation,
    planLines,
  };
}

export function printDockerUpgradeResult(result: DockerUpgradeResult): void {
  const prefix = result.dryRun ? "[dry-run] " : "";

  for (const line of result.planLines) {
    console.log(`${prefix}${line}`);
  }

  if (result.skipped) {
    console.log(result.skipReason ?? "Skipped.");
    return;
  }

  if (result.dryRun) {
    console.log("");
    console.log(
      "Run without --dry-run to back up, pull, recreate, and validate. Prefer -y in CI.",
    );
    return;
  }

  if (result.validation) {
    console.log("");
    console.log("Bank fact counts:");
    console.log(formatFactCountTable(result.validation.rows));
  }

  console.log("");
  console.log(
    `Upgrade OK: ${result.fromVersion} -> ${result.toVersion} (${result.targetImage})`,
  );
  console.log(`Container: ${result.containerName}`);
  console.log(`Volume: ${result.volumeName} (kept)`);
  if (result.backupDir) {
    console.log(`Backup: ${result.backupDir}`);
  }
  console.log(
    "MCP bank URLs are unchanged; consumer .cursor/mcp.json does not need updates.",
  );
}
