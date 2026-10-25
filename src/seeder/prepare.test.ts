import type { CandidateFact } from "../extractor/types.js";
import { createEmptyManifest } from "./manifest.js";
import { nextManifest, toRetainItems, type PreparedSeed } from "./prepare.js";

describe("toRetainItems", () => {
  it("maps candidate facts to Hindsight retain items with provenance", () => {
    const fact: CandidateFact = {
      id: "nocciolo:README.md#goal",
      title: "Goal",
      content: "Seed durable knowledge.",
      knowledgeKind: "overview",
      score: 5,
      provenance: {
        sourcePath: "README.md",
        kind: "readme",
        commit: "deadbeef",
      },
    };

    const items = toRetainItems([fact]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      document_id: "nocciolo:README.md#goal",
      timestamp: "unset",
      metadata: {
        source: "README.md",
        commit: "deadbeef",
        knowledge_kind: "overview",
      },
      tags: ["nocciolo", "kind:readme", "knowledge:overview"],
    });
  });

  it("uses catalog tags for a judged kind and keeps the document id", () => {
    const fact: CandidateFact = {
      id: "nocciolo:docs/adr/0001-local-bank.md#document",
      title: "ADR 0001",
      content: "We chose a local bank.",
      knowledgeKind: "decision",
      score: 10,
      bankKind: { id: "adr", tags: ["knowledge:adr"] },
      provenance: {
        sourcePath: "docs/adr/0001-local-bank.md",
        kind: "adr",
      },
    };

    const items = toRetainItems([fact]);
    expect(items[0]?.document_id).toBe(
      "nocciolo:docs/adr/0001-local-bank.md#document",
    );
    expect(items[0]?.document_id).not.toContain("knowledge:");
    expect(items[0]?.metadata?.knowledge_kind).toBe("adr");
    expect(items[0]?.tags).toEqual(["nocciolo", "kind:adr", "knowledge:adr"]);
  });
});

describe("nextManifest", () => {
  it("records a settled empty source and drops a reopened one", () => {
    const previous = createEmptyManifest("bank");
    previous.sources["docs/review.md"] = {
      contentHash: "old",
      factIds: ["nocciolo:docs/review.md#old"],
      seededAt: "2020-01-01T00:00:00.000Z",
    };
    const prepared: PreparedSeed = {
      projectRoot: "/tmp/p",
      bankId: "bank",
      sources: [
        {
          relativePath: "docs/changelog.md",
          contentHash: "hash-changelog",
          facts: [],
          heuristicSkips: [],
          skipped: true,
          skipReason: "Jev skipped every section",
          unchanged: false,
        },
        {
          relativePath: "docs/review.md",
          contentHash: "hash-review",
          facts: [],
          heuristicSkips: [],
          skipped: true,
          unchanged: false,
        },
      ],
      factsToRetain: [],
      skippedUnchanged: 0,
      skippedEmpty: 0,
      skippedTombstoned: 0,
    };

    const manifest = nextManifest(previous, "bank", prepared, new Set(), {
      settleEmptyPaths: new Set(["docs/changelog.md"]),
      reopenPaths: new Set(["docs/review.md"]),
    });

    expect(manifest.sources["docs/changelog.md"]?.factIds).toEqual([]);
    expect(manifest.sources["docs/changelog.md"]?.contentHash).toBe(
      "hash-changelog",
    );
    expect(manifest.sources["docs/review.md"]).toBeUndefined();
  });
});
