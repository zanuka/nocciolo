import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractFromSource } from "../extractor/extract.js";
import { hashContent } from "../extractor/hash.js";
import type { DurableSource } from "../scanner/durable-sources.js";
import { pathExists } from "../utils/fs.js";

export type PruneGroup = "path-gone" | "section-gone" | "explicit";

export interface PruneCandidate {
  documentId: string;
  group: PruneGroup;
  sourcePath?: string;
  sectionSlug?: string;
  contentHash?: string;
  reason: string;
}

export interface PrunePlan {
  pathGone: PruneCandidate[];
  sectionGone: PruneCandidate[];
  explicit: PruneCandidate[];
  all: PruneCandidate[];
}

export type ParsedDocumentId =
  | {
      kind: "section";
      documentId: string;
      sourcePath: string;
      sectionSlug: string;
    }
  | { kind: "path"; documentId: string; sourcePath: string }
  | { kind: "other"; documentId: string };

export function parseDocumentId(documentId: string): ParsedDocumentId {
  if (documentId.startsWith("nocciolo:")) {
    const rest = documentId.slice("nocciolo:".length);
    if (rest.length === 0) {
      return { kind: "other", documentId };
    }
    const hash = rest.lastIndexOf("#");
    if (hash > 0) {
      return {
        kind: "section",
        documentId,
        sourcePath: rest.slice(0, hash),
        sectionSlug: rest.slice(hash + 1),
      };
    }
    return {
      kind: "path",
      documentId,
      sourcePath: rest,
    };
  }

  if (
    !documentId.includes("://") &&
    (documentId.includes("/") || /\.[A-Za-z0-9]+$/.test(documentId))
  ) {
    return { kind: "path", documentId, sourcePath: documentId };
  }

  return { kind: "other", documentId };
}

export function sourcePathForDocumentId(documentId: string): string | undefined {
  const parsed = parseDocumentId(documentId);
  if (parsed.kind === "other") {
    return undefined;
  }
  return parsed.sourcePath;
}

function guessSourceKind(relativePath: string): DurableSource["kind"] {
  const lower = relativePath.toLowerCase();
  if (
    lower.includes("/adr/") ||
    lower.includes("/adrs/") ||
    lower.includes("/decisions/") ||
    /(^|\/)adr[s]?\//.test(lower)
  ) {
    return "adr";
  }
  if (basenameIsReadme(relativePath)) {
    return "readme";
  }
  return "docs";
}

function basenameIsReadme(relativePath: string): boolean {
  const base = relativePath.split("/").pop()?.toLowerCase() ?? "";
  return base === "readme.md" || base === "readme.markdown" || base === "readme.mdx";
}

async function currentFactIds(
  projectRoot: string,
  relativePath: string,
): Promise<{ exists: boolean; factIds: Set<string>; contentHash?: string }> {
  const absolutePath = join(projectRoot, relativePath);
  if (!(await pathExists(absolutePath))) {
    return { exists: false, factIds: new Set() };
  }
  const content = await readFile(absolutePath, "utf8");
  const contentHash = hashContent(content);
  const source: DurableSource = {
    absolutePath,
    relativePath,
    kind: guessSourceKind(relativePath),
  };
  const extracted = extractFromSource(source, content);
  return {
    exists: true,
    factIds: new Set(extracted.facts.map((f) => f.id)),
    contentHash,
  };
}

export async function buildPrunePlan(input: {
  projectRoot: string;
  documentIds: string[];
  documentId?: string;
  source?: string;
}): Promise<PrunePlan> {
  const pathGone: PruneCandidate[] = [];
  const sectionGone: PruneCandidate[] = [];
  const explicit: PruneCandidate[] = [];
  const seen = new Set<string>();

  const explicitIds = new Set<string>();
  if (input.documentId !== undefined && input.documentId.length > 0) {
    explicitIds.add(input.documentId);
  }
  const sourceFilter =
    input.source !== undefined && input.source.length > 0
      ? normalizeRelPath(input.source)
      : undefined;

  const sourceCache = new Map<
    string,
    Awaited<ReturnType<typeof currentFactIds>>
  >();

  async function cachedSource(relativePath: string) {
    const existing = sourceCache.get(relativePath);
    if (existing !== undefined) {
      return existing;
    }
    const value = await currentFactIds(input.projectRoot, relativePath);
    sourceCache.set(relativePath, value);
    return value;
  }

  const bankIds = [...input.documentIds];
  for (const id of explicitIds) {
    if (!bankIds.includes(id)) {
      bankIds.push(id);
    }
  }

  for (const documentId of bankIds) {
    const parsed = parseDocumentId(documentId);
    const matchesSource =
      sourceFilter !== undefined &&
      parsed.kind !== "other" &&
      normalizeRelPath(parsed.sourcePath) === sourceFilter;
    const isExplicitId = explicitIds.has(documentId);

    if (isExplicitId || matchesSource) {
      const candidate = await toExplicitCandidate(
        input.projectRoot,
        documentId,
        parsed,
        cachedSource,
        isExplicitId
          ? "selected via --document-id"
          : `selected via --source ${sourceFilter}`,
      );
      pushUnique(explicit, seen, candidate);
      continue;
    }

    if (parsed.kind === "section") {
      const current = await cachedSource(parsed.sourcePath);
      if (!current.exists) {
        pushUnique(pathGone, seen, {
          documentId,
          group: "path-gone",
          sourcePath: parsed.sourcePath,
          sectionSlug: parsed.sectionSlug,
          reason: "source path no longer on disk",
        });
        continue;
      }
      if (!current.factIds.has(documentId)) {
        pushUnique(sectionGone, seen, {
          documentId,
          group: "section-gone",
          sourcePath: parsed.sourcePath,
          sectionSlug: parsed.sectionSlug,
          ...(current.contentHash !== undefined
            ? { contentHash: current.contentHash }
            : {}),
          reason: "section no longer extracts to this document_id",
        });
      }
      continue;
    }

    if (parsed.kind === "path") {
      const current = await cachedSource(parsed.sourcePath);
      if (!current.exists) {
        pushUnique(pathGone, seen, {
          documentId,
          group: "path-gone",
          sourcePath: parsed.sourcePath,
          reason: "source path no longer on disk",
        });
      }
    }
  }

  const all = [...pathGone, ...sectionGone, ...explicit];
  return { pathGone, sectionGone, explicit, all };
}

async function toExplicitCandidate(
  projectRoot: string,
  documentId: string,
  parsed: ParsedDocumentId,
  cachedSource: (
    relativePath: string,
  ) => Promise<Awaited<ReturnType<typeof currentFactIds>>>,
  reason: string,
): Promise<PruneCandidate> {
  if (parsed.kind === "other") {
    return {
      documentId,
      group: "explicit",
      reason,
    };
  }
  const current = await cachedSource(parsed.sourcePath);
  const candidate: PruneCandidate = {
    documentId,
    group: "explicit",
    sourcePath: parsed.sourcePath,
    reason,
  };
  if (parsed.kind === "section") {
    candidate.sectionSlug = parsed.sectionSlug;
  }
  if (current.contentHash !== undefined) {
    candidate.contentHash = current.contentHash;
  }
  return candidate;
}

function pushUnique(
  bucket: PruneCandidate[],
  seen: Set<string>,
  candidate: PruneCandidate,
): void {
  if (seen.has(candidate.documentId)) {
    return;
  }
  seen.add(candidate.documentId);
  bucket.push(candidate);
}

function normalizeRelPath(path: string): string {
  return path.replace(/^\.\/+/, "").replace(/\\/g, "/");
}

export function selectCandidatesByIds(
  plan: PrunePlan,
  documentIds: Iterable<string>,
): PruneCandidate[] {
  const wanted = new Set(documentIds);
  return plan.all.filter((c) => wanted.has(c.documentId));
}
