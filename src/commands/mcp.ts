import { loadConfig } from "../config/load.js";
import { resolveHindsightBaseUrl } from "../providers/hindsight/client.js";
import { detectProjectRoot } from "../project/detect-root.js";
import { buildSingleBankMcpUrl } from "../integration/mcp-url.js";
import {
  filterSnippets,
  generateMcpSnippets,
  parseHarnessList,
  type McpHarness,
  type McpSnippet,
} from "../integration/snippets.js";
import {
  cursorBankRulePath,
  cursorMcpPath,
  kiroMcpPath,
  rooMcpPath,
  writeAgentsPreference,
  writeCursorBankRule,
  writeMergedMcpJson,
} from "../integration/write.js";
import {
  installFirstmateProjectBank,
  type InstallProjectBankSkillResult,
} from "../integration/project-bank-skill.js";
import { NoccioloError } from "../utils/errors.js";

export interface McpOptions {
  cwd?: string;
  dryRun?: boolean;
  force?: boolean;
  write?: boolean;
  writeAgents?: boolean;
  writeCursorRules?: boolean;
  writeRoo?: boolean;
  writeKiro?: boolean;
  writeFirstmate?: boolean;
  harness?: string;
  hindsightUrl?: string;
  apiKey?: string;
  includeAuth?: boolean;
}

export interface McpResult {
  projectRoot: string;
  bankId: string;
  baseUrl: string;
  mcpUrl: string;
  snippets: McpSnippet[];
  dryRun: boolean;
  writes: Array<{ path: string; wrote: boolean; dryRun: boolean }>;
  firstmateSkill?: InstallProjectBankSkillResult;
}

export async function runMcp(options: McpOptions = {}): Promise<McpResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const write = options.write ?? false;
  const writeAgents = options.writeAgents ?? false;
  const writeCursorRules = options.writeCursorRules ?? false;
  const writeRoo = options.writeRoo ?? false;
  const writeKiro = options.writeKiro ?? false;
  const writeFirstmate = options.writeFirstmate ?? false;

  if (
    dryRun &&
    !write &&
    !writeAgents &&
    !writeCursorRules &&
    !writeRoo &&
    !writeKiro &&
    !writeFirstmate
  ) {
    throw new NoccioloError(
      "--dry-run only applies when writing files",
      "Use --write, --write-agents, --write-cursor-rules, --write-roo, --write-kiro, and/or --write-firstmate with --dry-run to preview.",
    );
  }

  let harnesses: McpHarness[];
  try {
    harnesses = parseHarnessList(options.harness);
  } catch (error) {
    throw new NoccioloError(
      error instanceof Error ? error.message : String(error),
      `Pass --harness cursor,claude-code or omit for all.`,
    );
  }

  const projectRoot = await detectProjectRoot(cwd);
  const config = await loadConfig(projectRoot);
  const baseUrl = resolveHindsightBaseUrl({
    ...(options.hindsightUrl !== undefined
      ? { cliUrl: options.hindsightUrl }
      : {}),
    ...(config.hindsightBaseUrl !== undefined
      ? { configUrl: config.hindsightBaseUrl }
      : {}),
  });
  const includeAuth =
    options.includeAuth === true || options.apiKey !== undefined;

  const printSnippets = generateMcpSnippets({
    baseUrl,
    bankId: config.bankId,
    projectName: config.name,
    includeAuth,
    ...(options.apiKey !== undefined ? { apiKeyLiteral: options.apiKey } : {}),
  });

  const writeSnippets = generateMcpSnippets({
    baseUrl,
    bankId: config.bankId,
    projectName: config.name,
    includeAuth,
  });

  const snippets = filterSnippets(printSnippets, harnesses);
  const mcpUrl = buildSingleBankMcpUrl(baseUrl, config.bankId);
  const writes: McpResult["writes"] = [];

  if (write) {
    const cursor = writeSnippets.find((s) => s.harness === "cursor");
    if (!cursor) {
      throw new NoccioloError("Internal error: missing Cursor snippet");
    }
    writes.push(
      await writeMergedMcpJson(cursorMcpPath(projectRoot), cursor, {
        dryRun,
        force,
      }),
    );
  }

  if (writeRoo) {
    const roo = writeSnippets.find((s) => s.harness === "roo");
    if (!roo) {
      throw new NoccioloError("Internal error: missing Roo snippet");
    }
    writes.push(
      await writeMergedMcpJson(rooMcpPath(projectRoot), roo, {
        dryRun,
        force,
      }),
    );
  }

  if (writeKiro) {
    const kiro = writeSnippets.find((s) => s.harness === "kiro");
    if (!kiro) {
      throw new NoccioloError("Internal error: missing Kiro snippet");
    }
    writes.push(
      await writeMergedMcpJson(kiroMcpPath(projectRoot), kiro, {
        dryRun,
        force,
      }),
    );
  }

  if (writeAgents) {
    writes.push(
      await writeAgentsPreference(
        projectRoot,
        {
          projectName: config.name,
          bankId: config.bankId,
          baseUrl,
        },
        { dryRun },
      ),
    );
  }

  if (writeCursorRules) {
    writes.push(
      await writeCursorBankRule(
        projectRoot,
        {
          projectName: config.name,
          bankId: config.bankId,
          baseUrl,
        },
        { dryRun, force },
      ),
    );
  }

  let firstmateSkill: InstallProjectBankSkillResult | undefined;
  if (writeFirstmate) {
    firstmateSkill = await installFirstmateProjectBank({
      projectRoot,
      bankId: config.bankId,
      hindsightBaseUrl: baseUrl,
      dryRun,
      force,
    });
  }

  return {
    projectRoot,
    bankId: config.bankId,
    baseUrl,
    mcpUrl,
    snippets,
    dryRun,
    writes,
    ...(firstmateSkill !== undefined ? { firstmateSkill } : {}),
  };
}

export function printMcpResult(result: McpResult): void {
  console.log(`Project bank: ${result.bankId}`);
  console.log(`Hindsight:    ${result.baseUrl}`);
  console.log(`MCP URL:      ${result.mcpUrl}`);
  console.log("");

  for (const snippet of result.snippets) {
    console.log(`--- ${snippet.title} → ${snippet.targetPath} ---`);
    for (const note of snippet.notes) {
      console.log(`# ${note}`);
    }
    console.log(snippet.body.trimEnd());
    console.log("");
  }

  if (result.firstmateSkill) {
    const prefix = result.dryRun ? "[dry-run] " : "";
    const skill = result.firstmateSkill;
    if (skill.printOnly) {
      console.log("$FM_HOME is not set: printing install steps instead of writing.");
      console.log("Run this from the Firstmate home (or with FM_HOME set):");
      console.log(`  mkdir -p "$FM_HOME/.agents/skills/project-bank"`);
      console.log(
        `  # write the project-bank skill (see docs/firstmate/project-bank/SKILL.md in this repo) to`,
      );
      console.log(`  # $FM_HOME/.agents/skills/project-bank/SKILL.md`);
      console.log(
        `  # then record { "${result.projectRoot}": { "bankId": "${result.bankId}", "hindsightBaseUrl": "${result.baseUrl}" } }`,
      );
      console.log(`  # under "projects" in $FM_HOME/.nocciolo/projects.json`);
    } else {
      const verb = result.dryRun ? "Would write" : "Wrote";
      console.log(`${prefix}${verb}: ${skill.skillPath}`);
      console.log(`${prefix}${verb}: ${skill.registryPath}`);
    }
    console.log("");
  }

  if (result.writes.length > 0) {
    const prefix = result.dryRun ? "[dry-run] " : "";
    for (const w of result.writes) {
      const verb = result.dryRun ? "Would write" : "Wrote";
      console.log(`${prefix}${verb}: ${w.path}`);
    }
    if (result.dryRun) {
      console.log("No files were written.");
    }
  } else if (!result.firstmateSkill) {
    console.log(
      "Tip: `nocciolo mcp --write` writes .cursor/mcp.json; add --write-agents / --write-cursor-rules for agent preference text.",
    );
    console.log(
      "Use --include-auth to add Authorization headers (env placeholders when writing files).",
    );
  }
}

export { cursorBankRulePath, cursorMcpPath };
