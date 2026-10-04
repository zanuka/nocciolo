import { dirname, join } from "node:path";
import { NoccioloError } from "../utils/errors.js";
import {
  ensureDir,
  pathExists,
  readJsonFile,
  writeJsonFile,
  writeTextFile,
} from "../utils/fs.js";
import { readFile } from "node:fs/promises";
import {
  buildAgentsBankSection,
  buildCursorBankRule,
  upsertAgentsBankSection,
  type AgentRulesInput,
} from "./agent-rules.js";
import type { McpSnippet } from "./snippets.js";

export interface CursorMcpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export function cursorMcpPath(projectRoot: string): string {
  return join(projectRoot, ".cursor", "mcp.json");
}

export function rooMcpPath(projectRoot: string): string {
  return join(projectRoot, ".roo", "mcp.json");
}

export function kiroMcpPath(projectRoot: string): string {
  return join(projectRoot, ".kiro", "settings", "mcp.json");
}

export function agentsMdPath(projectRoot: string): string {
  return join(projectRoot, "AGENTS.md");
}

export function cursorBankRulePath(projectRoot: string): string {
  return join(projectRoot, ".cursor", "rules", "hindsight-bank.mdc");
}

export function parseCursorMcpSnippet(snippet: McpSnippet): CursorMcpConfig {
  return JSON.parse(snippet.body) as CursorMcpConfig;
}

export function mergeMcpServers(
  existing: CursorMcpConfig | null,
  incoming: CursorMcpConfig,
  force: boolean,
): CursorMcpConfig {
  const existingServers = existing?.mcpServers ?? {};
  const incomingServers = incoming.mcpServers ?? {};
  const merged: Record<string, unknown> = { ...existingServers };

  for (const [name, server] of Object.entries(incomingServers)) {
    if (name in merged && !force) {
      throw new NoccioloError(
        `MCP server "${name}" already exists in the target config`,
        `Use --force to overwrite the "${name}" entry, or edit the file manually.`,
      );
    }
    merged[name] = server;
  }

  return {
    ...existing,
    ...incoming,
    mcpServers: merged,
  };
}

export async function writeMergedMcpJson(
  targetPath: string,
  snippet: McpSnippet,
  options: { dryRun: boolean; force: boolean },
): Promise<{ path: string; wrote: boolean; dryRun: boolean }> {
  const incoming = parseCursorMcpSnippet(snippet);
  let existing: CursorMcpConfig | null = null;
  if (await pathExists(targetPath)) {
    existing = await readJsonFile<CursorMcpConfig>(targetPath);
  }
  const merged = mergeMcpServers(existing, incoming, options.force);

  if (!options.dryRun) {
    await ensureDir(dirname(targetPath));
  }
  await writeJsonFile(targetPath, merged, options.dryRun);

  return {
    path: targetPath,
    wrote: !options.dryRun,
    dryRun: options.dryRun,
  };
}

export async function writeAgentsPreference(
  projectRoot: string,
  input: AgentRulesInput,
  options: { dryRun: boolean },
): Promise<{ path: string; wrote: boolean; dryRun: boolean; preview: string }> {
  const path = agentsMdPath(projectRoot);
  const existing = (await pathExists(path))
    ? await readFile(path, "utf8")
    : "";
  const next = upsertAgentsBankSection(existing, input);

  await writeTextFile(path, next, options.dryRun);

  return {
    path,
    wrote: !options.dryRun,
    dryRun: options.dryRun,
    preview: options.dryRun ? buildAgentsBankSection(input) : next,
  };
}

export async function writeCursorBankRule(
  projectRoot: string,
  input: AgentRulesInput,
  options: { dryRun: boolean; force: boolean },
): Promise<{ path: string; wrote: boolean; dryRun: boolean; content: string }> {
  const path = cursorBankRulePath(projectRoot);
  const content = buildCursorBankRule(input);
  const exists = await pathExists(path);

  if (exists && !options.force && !options.dryRun) {
    throw new NoccioloError(
      `Cursor rule already exists at ${path}`,
      "Use --force to overwrite, or `nocciolo mcp --write-cursor-rules --dry-run` to preview.",
    );
  }

  if (!options.dryRun) {
    await ensureDir(dirname(path));
  }
  await writeTextFile(path, content, options.dryRun);

  return {
    path,
    wrote: !options.dryRun,
    dryRun: options.dryRun,
    content,
  };
}
