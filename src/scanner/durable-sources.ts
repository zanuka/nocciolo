import { readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { pathExists } from "../utils/fs.js";
import {
  isSensitiveRelativePath,
  isSkippableTraversalDirectory,
} from "./sensitive.js";

export interface DurableSource {
  absolutePath: string;
  relativePath: string;
  kind: "readme" | "docs" | "adr";
}

const ROOT_FILES: Array<{ name: string; kind: DurableSource["kind"] }> = [
  { name: "README.md", kind: "readme" },
];

const DOC_DIRS = ["docs", "doc", "documentation"];
const ADR_DIRS = ["adr", "adrs", "docs/adr", "docs/adrs", "docs/decisions"];

export async function findDurableSources(
  projectRoot: string,
): Promise<DurableSource[]> {
  const found: DurableSource[] = [];
  const seen = new Set<string>();

  const add = async (
    absolutePath: string,
    kind: DurableSource["kind"],
  ): Promise<void> => {
    if (!(await pathExists(absolutePath))) {
      return;
    }
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      return;
    }
    const relativePath = relative(projectRoot, absolutePath);
    if (isSensitiveRelativePath(relativePath)) {
      return;
    }
    if (seen.has(relativePath)) {
      return;
    }
    seen.add(relativePath);
    found.push({ absolutePath, relativePath, kind });
  };

  for (const file of ROOT_FILES) {
    await add(join(projectRoot, file.name), file.kind);
  }

  for (const dir of DOC_DIRS) {
    await collectMarkdown(
      join(projectRoot, dir),
      projectRoot,
      "docs",
      found,
      seen,
    );
  }

  for (const dir of ADR_DIRS) {
    await collectMarkdown(
      join(projectRoot, dir),
      projectRoot,
      "adr",
      found,
      seen,
    );
  }

  const rootEntries = await safeReaddir(projectRoot);
  for (const entry of rootEntries) {
    const lower = entry.toLowerCase();
    if (
      lower.startsWith("adr") &&
      (lower.endsWith(".md") || lower.endsWith(".markdown"))
    ) {
      await add(join(projectRoot, entry), "adr");
    }
  }

  found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return found;
}

async function collectMarkdown(
  dir: string,
  projectRoot: string,
  kind: DurableSource["kind"],
  found: DurableSource[],
  seen: Set<string>,
): Promise<void> {
  if (!(await pathExists(dir))) {
    return;
  }
  const info = await stat(dir);
  if (!info.isDirectory()) {
    return;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isSkippableTraversalDirectory(entry.name)) {
        continue;
      }
      await collectMarkdown(absolutePath, projectRoot, kind, found, seen);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith(".md") && !lower.endsWith(".markdown")) {
      continue;
    }
    const relativePath = relative(projectRoot, absolutePath);
    if (isSensitiveRelativePath(relativePath)) {
      continue;
    }
    if (seen.has(relativePath)) {
      continue;
    }
    seen.add(relativePath);
    found.push({ absolutePath, relativePath, kind });
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function summarizeSource(source: DurableSource): string {
  switch (source.kind) {
    case "readme":
      return "Project overview and goals";
    case "adr":
      return `Decision record (${basename(source.relativePath)})`;
    case "docs":
      return `Documentation (${basename(source.relativePath)})`;
  }
}
