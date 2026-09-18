import { isAbsolute, relative } from "node:path";
import { isSensitiveRelativePath } from "./sensitive.js";

const DENIED_BASENAMES = new Set([".stow-archive.md", ".stow-notes.md"]);

const DENIED_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.backpass\//i,
  /(^|\/)node_modules\//i,
];

export interface StoreDenyReason {
  denied: boolean;
  reason?: string;
}

/**
 * Store's denylist is stricter than the seed scanner's: it also blocks
 * .stow-archive.md / .stow-notes.md (Firstmate disk-pref files, not project
 * knowledge) and .backpass/ trees, and requires paths to stay inside the
 * project root and be markdown.
 */
export function checkStoreDeny(
  relativePath: string,
  projectRoot: string,
  options: { explicit?: boolean } = {},
): StoreDenyReason {
  const normalized = relativePath.split(/[/\\]/).join("/");
  const basename = normalized.split("/").pop() ?? normalized;

  if (normalized.startsWith("..") || isAbsolute(normalized)) {
    return { denied: true, reason: "path resolves outside the project root" };
  }

  if (isSensitiveRelativePath(normalized)) {
    return { denied: true, reason: "matches secrets/credentials denylist" };
  }

  if (!/\.(md|markdown)$/i.test(basename)) {
    return { denied: true, reason: "not a markdown file" };
  }

  for (const pattern of DENIED_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return { denied: true, reason: "matches denied path pattern" };
    }
  }

  if (!options.explicit && DENIED_BASENAMES.has(basename.toLowerCase())) {
    return {
      denied: true,
      reason: "Firstmate disk-pref file (pass --files to override explicitly)",
    };
  }

  return { denied: false };
}

export function relativeToProjectRoot(
  projectRoot: string,
  absolutePath: string,
): string {
  return relative(projectRoot, absolutePath).split(/[/\\]/).join("/");
}
