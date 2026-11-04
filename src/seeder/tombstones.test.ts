import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addTombstones,
  clearTombstonesForIds,
  filterTombstonedFacts,
  isTombstoned,
  loadTombstones,
} from "./tombstones.js";

describe("tombstones", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempRoot(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-tomb-"));
    dirs.push(dir);
    return dir;
  }

  it("skips matching contentHash and missing hash, allows force and hash change", () => {
    const tombs = {
      version: 1 as const,
      bankId: "b",
      updatedAt: "t",
      entries: {
        "orto:a.md#x": { contentHash: "abc", prunedAt: "t" },
        "orto:b.md#y": { prunedAt: "t" },
      },
    };

    expect(isTombstoned("orto:a.md#x", "abc", tombs, false)).toBe(true);
    expect(isTombstoned("orto:a.md#x", "changed", tombs, false)).toBe(
      false,
    );
    expect(isTombstoned("orto:a.md#x", "abc", tombs, true)).toBe(false);
    expect(isTombstoned("orto:b.md#y", "anything", tombs, false)).toBe(
      true,
    );

    const { kept, skipped } = filterTombstonedFacts(
      [{ id: "orto:a.md#x" }, { id: "orto:c.md#z" }],
      "abc",
      tombs,
      false,
    );
    expect(skipped).toBe(1);
    expect(kept.map((f) => f.id)).toEqual(["orto:c.md#z"]);
  });

  it("persists and clears tombstone entries", async () => {
    const root = await tempRoot();
    await addTombstones(root, "bank", [
      {
        documentId: "orto:docs/a.md#s",
        sourcePath: "docs/a.md",
        contentHash: "h1",
      },
    ]);
    const loaded = await loadTombstones(root);
    expect(loaded?.entries["orto:docs/a.md#s"]?.contentHash).toBe("h1");

    await clearTombstonesForIds(root, ["orto:docs/a.md#s"]);
    const after = await loadTombstones(root);
    expect(after?.entries["orto:docs/a.md#s"]).toBeUndefined();
  });
});
