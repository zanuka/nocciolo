import { readFile } from "node:fs/promises";
import { extractFromSource } from "../extractor/extract.js";
import type { CandidateFact, ExtractedSource, ObservationLink } from "../extractor/types.js";
import type { RetainItem } from "../providers/hindsight/client.js";
import { findDurableSources } from "../scanner/durable-sources.js";
import type { ScannerPolicy } from "../scanner/policy.js";
import { resolveGitCommit } from "../project/git.js";
import {
  createEmptyManifest,
  loadSeedManifest,
  type SeedManifest,
} from "./manifest.js";
import { filterTombstonedFacts, loadTombstones } from "./tombstones.js";

export interface PreparedSeed {
  projectRoot: string;
  bankId: string;
  commit?: string;
  sources: PreparedSource[];
  factsToRetain: CandidateFact[];
  skippedUnchanged: number;
  skippedEmpty: number;
  skippedTombstoned: number;
}

export interface PreparedSource extends ExtractedSource {
  unchanged: boolean;
}

export async function prepareSeed(input: {
  projectRoot: string;
  bankId: string;
  force?: boolean;
  /**
   * Restrict extraction to these relative paths (used by `store` to retain a
   * selected subset instead of every discovered durable source). Omit to
   * process everything the scanner finds, which is seed's default.
   */
  only?: ReadonlySet<string>;
  scanner?: ScannerPolicy;
}): Promise<PreparedSeed> {
  const commit = await resolveGitCommit(input.projectRoot);
  const allSources = await findDurableSources(input.projectRoot, input.scanner);
  const sources =
    input.only === undefined
      ? allSources
      : allSources.filter((s) => input.only?.has(s.relativePath));
  const manifest =
    (await loadSeedManifest(input.projectRoot)) ??
    createEmptyManifest(input.bankId);

  const tombstones = await loadTombstones(input.projectRoot);
  const force = input.force ?? false;
  const prepared: PreparedSource[] = [];
  const factsToRetain: CandidateFact[] = [];
  let skippedUnchanged = 0;
  let skippedEmpty = 0;
  let skippedTombstoned = 0;

  for (const source of sources) {
    const content = await readFile(source.absolutePath, "utf8");
    const extracted = extractFromSource(
      source,
      content,
      commit !== undefined ? { commit } : {},
    );

    const previous = manifest.sources[source.relativePath];
    const unchanged =
      !force &&
      previous !== undefined &&
      previous.contentHash === extracted.contentHash;

    if (unchanged) {
      skippedUnchanged += 1;
      prepared.push({ ...extracted, unchanged: true });
      continue;
    }

    const { kept, skipped } = filterTombstonedFacts(
      extracted.facts,
      extracted.contentHash,
      tombstones,
      force,
    );
    skippedTombstoned += skipped;
    const heuristicSkips = filterTombstonedFacts(
      extracted.heuristicSkips,
      extracted.contentHash,
      tombstones,
      force,
    ).kept;

    if (kept.length === 0) {
      skippedEmpty += 1;
      prepared.push({
        ...extracted,
        facts: kept,
        heuristicSkips,
        unchanged: false,
      });
      continue;
    }

    prepared.push({
      ...extracted,
      facts: kept,
      heuristicSkips,
      unchanged: false,
    });
    factsToRetain.push(...kept);
  }

  const result: PreparedSeed = {
    projectRoot: input.projectRoot,
    bankId: input.bankId,
    sources: prepared,
    factsToRetain,
    skippedUnchanged,
    skippedEmpty,
    skippedTombstoned,
  };
  if (commit !== undefined) {
    result.commit = commit;
  }
  return result;
}

function joinObservationIds(
  fact: CandidateFact,
  relation: ObservationLink["relation"],
): string | undefined {
  const ids = (fact.observationLinks ?? [])
    .filter((link) => link.relation === relation)
    .map((link) => link.observationId)
    .filter((id) => id !== "" && !id.includes("|"));
  if (ids.length === 0) {
    return undefined;
  }
  return ids.join("|");
}

export function toRetainItems(facts: CandidateFact[]): RetainItem[] {
  return facts.map((fact) => {
    const knowledgeTags =
      fact.bankKind !== undefined
        ? fact.bankKind.tags
        : [`knowledge:${fact.knowledgeKind}`];
    const metadata: Record<string, string> = {
      source: fact.provenance.sourcePath,
      kind: fact.provenance.kind,
      knowledge_kind: fact.bankKind?.id ?? fact.knowledgeKind,
      title: fact.title,
      nocciolo_fact_id: fact.id,
    };
    if (fact.provenance.commit) {
      metadata.commit = fact.provenance.commit;
    }
    const supersedes = joinObservationIds(fact, "supersedes");
    const contradicts = joinObservationIds(fact, "contradicts");
    if (supersedes !== undefined) {
      metadata.supersedes = supersedes;
    }
    if (contradicts !== undefined) {
      metadata.contradicts = contradicts;
    }

    return {
      content: fact.content,
      context: `durable project docs (${fact.provenance.kind}): ${fact.provenance.sourcePath}`,
      document_id: fact.id,
      timestamp: "unset",
      metadata,
      tags: ["nocciolo", `kind:${fact.provenance.kind}`, ...knowledgeTags],
    };
  });
}

export interface NextManifestOptions {
  settleEmptyPaths?: ReadonlySet<string>;
  reopenPaths?: ReadonlySet<string>;
}

export function nextManifest(
  previous: SeedManifest | undefined,
  bankId: string,
  prepared: PreparedSeed,
  retainedFactIds: Set<string>,
  options?: NextManifestOptions,
): SeedManifest {
  const sources: SeedManifest["sources"] = {
    ...(previous?.bankId === bankId ? previous.sources : {}),
  };
  const now = new Date().toISOString();

  for (const source of prepared.sources) {
    if (options?.reopenPaths?.has(source.relativePath)) {
      delete sources[source.relativePath];
      continue;
    }
    if (source.unchanged) {
      continue;
    }
    if (source.facts.length === 0) {
      if (options?.settleEmptyPaths?.has(source.relativePath)) {
        sources[source.relativePath] = {
          contentHash: source.contentHash,
          factIds: [],
          seededAt: now,
        };
        continue;
      }
      delete sources[source.relativePath];
      continue;
    }
    const factIds = source.facts
      .map((f) => f.id)
      .filter((id) => retainedFactIds.has(id));
    if (factIds.length === 0) {
      continue;
    }
    sources[source.relativePath] = {
      contentHash: source.contentHash,
      factIds,
      seededAt: now,
    };
  }

  return {
    version: 1,
    bankId,
    updatedAt: now,
    sources,
  };
}
