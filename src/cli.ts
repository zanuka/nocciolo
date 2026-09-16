import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runConfigure, printConfigureResult } from "./commands/configure.js";
import {
  parseDockerAction,
  printDockerResult,
  runDockerHelper,
} from "./commands/docker.js";
import {
  printDockerUpgradeResult,
  runDockerUpgrade,
} from "./commands/docker-upgrade.js";
import { printInitResult, runInit } from "./commands/init.js";
import { printMcpResult, runMcp } from "./commands/mcp.js";
import { runSeedCommand } from "./commands/seed.js";
import { formatError } from "./utils/errors.js";

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("nocciolo")
    .description(
      "Company brain config for AI agents — seed Hindsight banks from durable project knowledge",
    )
    .version(readPackageVersion());

  program
    .command("init")
    .description("Detect project root and scaffold .nocciolo/ config")
    .option("--dry-run", "Show what would be written without creating files")
    .option("--force", "Overwrite an existing .nocciolo/config.json")
    .option("--name <name>", "Project name (defaults to directory name)")
    .option(
      "--bank-id <id>",
      "Hindsight bank id (defaults to a slug of the project name)",
    )
    .option(
      "--container-name <name>",
      "Local Hindsight Docker container name (default: hindsight; shared across banks)",
    )
    .option("-y, --yes", "Accept defaults without interactive prompts")
    .action(
      async (opts: {
        dryRun?: boolean;
        force?: boolean;
        name?: string;
        bankId?: string;
        containerName?: string;
        yes?: boolean;
      }) => {
        const result = await runInit({
          dryRun: Boolean(opts.dryRun),
          force: Boolean(opts.force),
          yes: Boolean(opts.yes),
          ...(opts.name !== undefined ? { name: opts.name } : {}),
          ...(opts.bankId !== undefined ? { bankId: opts.bankId } : {}),
          ...(opts.containerName !== undefined
            ? { containerName: opts.containerName }
            : {}),
        });
        printInitResult(result);
      },
    );

  program
    .command("configure")
    .description("Generate a Hindsight bank template into .nocciolo/")
    .option("--dry-run", "Print the template without writing files")
    .option("--force", "Overwrite an existing bank template")
    .action(async (opts: { dryRun?: boolean; force?: boolean }) => {
      const result = await runConfigure({
        dryRun: Boolean(opts.dryRun),
        force: Boolean(opts.force),
      });
      printConfigureResult(result);
    });

  program
    .command("seed")
    .description("Retain durable knowledge into the configured bank")
    .option(
      "--dry-run",
      "Preview extracted candidates without calling Hindsight",
    )
    .option("--force", "Re-seed even when source content is unchanged")
    .option(
      "--hindsight-url <url>",
      "Hindsight base URL (default: config, NOCCIOLO_HINDSIGHT_URL, or http://localhost:8888)",
    )
    .option(
      "--api-key <key>",
      "Hindsight API key (or set NOCCIOLO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY)",
    )
    .option("--async", "Submit retain asynchronously to Hindsight")
    .action(
      async (opts: {
        dryRun?: boolean;
        force?: boolean;
        hindsightUrl?: string;
        apiKey?: string;
        async?: boolean;
      }) => {
        await runSeedCommand({
          dryRun: Boolean(opts.dryRun),
          force: Boolean(opts.force),
          async: Boolean(opts.async),
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
      },
    );

  program
    .command("mcp")
    .description("Emit MCP / agent config snippets for the project bank")
    .option(
      "--harness <list>",
      "Comma-separated harnesses: cursor,claude-code,claude-desktop,roo,codex,kiro,firstmate,all",
    )
    .option("--write", "Write/merge .cursor/mcp.json for the project bank")
    .option("--write-roo", "Write/merge .roo/mcp.json")
    .option("--write-kiro", "Write/merge .kiro/settings/mcp.json")
    .option(
      "--write-agents",
      "Upsert an AGENTS.md section telling agents to prefer the project bank",
    )
    .option(
      "--write-cursor-rules",
      "Write .cursor/rules/hindsight-bank.mdc (alwaysApply)",
    )
    .option("--dry-run", "Preview file writes without mutating the filesystem")
    .option("--force", "Overwrite existing MCP server entry / Cursor rule")
    .option(
      "--hindsight-url <url>",
      "Hindsight base URL (default: config, NOCCIOLO_HINDSIGHT_URL, or http://localhost:8888)",
    )
    .option(
      "--include-auth",
      "Include Authorization headers (env placeholders when writing files)",
    )
    .option(
      "--api-key <key>",
      "Include this API key literally in printed snippets (writes still use env placeholders)",
    )
    .action(
      async (opts: {
        harness?: string;
        write?: boolean;
        writeRoo?: boolean;
        writeKiro?: boolean;
        writeAgents?: boolean;
        writeCursorRules?: boolean;
        dryRun?: boolean;
        force?: boolean;
        hindsightUrl?: string;
        includeAuth?: boolean;
        apiKey?: string;
      }) => {
        const result = await runMcp({
          dryRun: Boolean(opts.dryRun),
          force: Boolean(opts.force),
          write: Boolean(opts.write),
          writeRoo: Boolean(opts.writeRoo),
          writeKiro: Boolean(opts.writeKiro),
          writeAgents: Boolean(opts.writeAgents),
          writeCursorRules: Boolean(opts.writeCursorRules),
          includeAuth: Boolean(opts.includeAuth),
          ...(opts.harness !== undefined ? { harness: opts.harness } : {}),
          ...(opts.hindsightUrl !== undefined
            ? { hindsightUrl: opts.hindsightUrl }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
        printMcpResult(result);
      },
    );

  const docker = program
    .command("docker")
    .description(
      "Local Hindsight Docker helper (up / down / status / print / upgrade)",
    )
    .argument(
      "[action]",
      "up|start, down|stop, status, or print (default: print)",
      "print",
    )
    .option("--dry-run", "Print the docker command without executing")
    .option(
      "--name <name>",
      "Container name (default: config docker.containerName, or hindsight)",
    )
    .option("--api-port <port>", "Host port for Hindsight API (default: 8888)")
    .option("--ui-port <port>", "Host port for Control Plane UI (default: 9999)")
    .option(
      "--image <image>",
      "Docker image (default: ghcr.io/vectorize-io/hindsight:latest)",
    )
    .option(
      "--llm-api-key <key>",
      "LLM provider API key (or OPENAI_API_KEY / HINDSIGHT_API_LLM_API_KEY)",
    )
    .option(
      "--llm-provider <name>",
      "HINDSIGHT_API_LLM_PROVIDER (openai, anthropic, ollama, …)",
    )
    .option(
      "--api-key <key>",
      "Enable tenant API auth on the container (HINDSIGHT_API_TENANT_API_KEY)",
    )
    .option("--no-pull", "Do not pass --pull always")
    .option("--no-detach", "Run attached (-it) instead of -d")
    .action(
      async (
        actionArg: string,
        opts: {
          dryRun?: boolean;
          name?: string;
          apiPort?: string;
          uiPort?: string;
          image?: string;
          llmApiKey?: string;
          llmProvider?: string;
          apiKey?: string;
          pull?: boolean;
          detach?: boolean;
        },
      ) => {
        const action = parseDockerAction(actionArg);
        const result = await runDockerHelper({
          action,
          dryRun: Boolean(opts.dryRun) || action === "print",
          pull: opts.pull !== false,
          detach: opts.detach !== false,
          ...(opts.name !== undefined ? { containerName: opts.name } : {}),
          ...(opts.apiPort !== undefined
            ? { apiPort: Number(opts.apiPort) }
            : {}),
          ...(opts.uiPort !== undefined
            ? { uiPort: Number(opts.uiPort) }
            : {}),
          ...(opts.image !== undefined ? { image: opts.image } : {}),
          ...(opts.llmApiKey !== undefined
            ? { llmApiKey: opts.llmApiKey }
            : {}),
          ...(opts.llmProvider !== undefined
            ? { llmProvider: opts.llmProvider }
            : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
        printDockerResult(result);
      },
    );

  docker
    .command("upgrade")
    .description(
      "Upgrade the local Hindsight Docker image to a pinned tag. Backs up all banks, recreates the container on the same data volume, then verifies /version and bank fact counts.",
    )
    .requiredOption(
      "--to <version>",
      "Target Hindsight image tag (pinned; e.g. 0.9.2). :latest is refused.",
    )
    .option("--dry-run", "Print backup + pull + recreate plan without mutating")
    .option(
      "--backup-dir <path>",
      "Backup directory (default: ~/hindsight-bank-backups/pre-<to>-<timestamp>/)",
    )
    .option(
      "--skip-backup",
      "Skip backups (dangerous; loud warning; default off)",
    )
    .option(
      "--force",
      "Recreate even when api_version already matches --to",
    )
    .option(
      "--all-banks",
      "Back up and validate every bank on the instance (default: on)",
      true,
    )
    .option(
      "--bank <id>",
      "Emphasize this project bank in backup notes (default: config bankId)",
    )
    .option("-y, --yes", "Skip TTY confirmation prompts")
    .option(
      "--hindsight-url <url>",
      "Hindsight base URL (default: config, NOCCIOLO_HINDSIGHT_URL, or http://localhost:8888)",
    )
    .option(
      "--api-key <key>",
      "Hindsight API key (or set NOCCIOLO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY)",
    )
    .option(
      "--name <name>",
      "Container name (default: config docker.containerName, or hindsight)",
    )
    .action(
      async (
        opts: {
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
          name?: string;
        },
        command: Command,
      ) => {
        const merged = command.optsWithGlobals() as typeof opts;
        const result = await runDockerUpgrade({
          to: merged.to,
          dryRun: Boolean(merged.dryRun),
          skipBackup: Boolean(merged.skipBackup),
          force: Boolean(merged.force),
          allBanks: merged.allBanks !== false,
          yes: Boolean(merged.yes),
          ...(merged.backupDir !== undefined
            ? { backupDir: merged.backupDir }
            : {}),
          ...(merged.bank !== undefined ? { bank: merged.bank } : {}),
          ...(merged.hindsightUrl !== undefined
            ? { hindsightUrl: merged.hindsightUrl }
            : {}),
          ...(merged.apiKey !== undefined ? { apiKey: merged.apiKey } : {}),
          ...(merged.name !== undefined ? { containerName: merged.name } : {}),
        });
        printDockerUpgradeResult(result);
      },
    );

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
