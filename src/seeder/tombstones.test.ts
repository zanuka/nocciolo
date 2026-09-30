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
    const dir = await mkdtemp(join(tmpdir(), "nocciolo-tomb-"));
    dirs.push(dir);
    return dir;
  }

  it("skips matching contentHash and missing hash, allows force and hash change", () => {
    const tombs = {
      version: 1 as const,
      bankId: "b",
      updatedAt: "t",
      entries: {
        "nocciolo:a.md#x": { contentHash: "abc", prunedAt: "t" },
        "nocciolo:b.md#y": { prunedAt: "t" },
      },
    };

    expect(isTombstoned("nocciolo:a.md#x", "abc", tombs, false)).toBe(true);
    expect(isTombstoned("nocciolo:a.md#x", "changed", tombs, false)).toBe(
      false,
    );
    expect(isTombstoned("nocciolo:a.md#x", "abc", tombs, true)).toBe(false);
    expect(isTombstoned("nocciolo:b.md#y", "anything", tombs, false)).toBe(
      true,
    );

    const { kept, skipped } = filterTombstonedFacts(
      [{ id: "nocciolo:a.md#x" }, { id: "nocciolo:c.md#z" }],
      "abc",
      tombs,
      false,
    );
    expect(skipped).toBe(1);
    expect(kept.map((f) => f.id)).toEqual(["nocciolo:c.md#z"]);
  });

  it("persists and clears tombstone entries", async () => {
    const root = await tempRoot();
    await addTombstones(root, "bank", [
      {
        documentId: "nocciolo:docs/a.md#s",
        sourcePath: "docs/a.md",
        contentHash: "h1",
      },
    ]);
    const loaded = await loadTombstones(root);
    expect(loaded?.entries["nocciolo:docs/a.md#s"]?.contentHash).toBe("h1");

    await clearTombstonesForIds(root, ["nocciolo:docs/a.md#s"]);
    const after = await loadTombstones(root);
    expect(after?.entries["nocciolo:docs/a.md#s"]).toBeUndefined();
  });
});
