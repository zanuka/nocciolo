import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareSeed } from "./prepare.js";
import { addTombstones } from "./tombstones.js";

describe("prepareSeed tombstone skip", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "nocciolo-prepare-tomb-"));
    dirs.push(dir);
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(
      join(dir, "docs", "live.md"),
      "# Goal\n\nThis section stays durable and meaningful enough for extraction.\n",
      "utf8",
    );
    return dir;
  }

  it("skips tombstoned facts when contentHash matches and allows force", async () => {
    const root = await tempProject();
    const first = await prepareSeed({ projectRoot: root, bankId: "b" });
    const fact = first.factsToRetain.find((f) =>
      f.id.endsWith("#goal"),
    );
    expect(fact).toBeDefined();
    const contentHash = first.sources.find(
      (s) => s.relativePath === "docs/live.md",
    )?.contentHash;
    expect(contentHash).toBeDefined();

    await addTombstones(root, "b", [
      {
        documentId: fact!.id,
        sourcePath: "docs/live.md",
        contentHash: contentHash!,
      },
    ]);

    const skipped = await prepareSeed({ projectRoot: root, bankId: "b" });
    expect(skipped.skippedTombstoned).toBeGreaterThan(0);
    expect(skipped.factsToRetain.some((f) => f.id === fact!.id)).toBe(false);

    const forced = await prepareSeed({
      projectRoot: root,
      bankId: "b",
      force: true,
    });
    expect(forced.factsToRetain.some((f) => f.id === fact!.id)).toBe(true);
  });
});
