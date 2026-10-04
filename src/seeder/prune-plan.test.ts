import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPrunePlan, parseDocumentId } from "./prune-plan.js";

describe("parseDocumentId", () => {
  it("parses section, path, and other ids", () => {
    expect(parseDocumentId("nocciolo:docs/a.md#goal")).toEqual({
      kind: "section",
      documentId: "nocciolo:docs/a.md#goal",
      sourcePath: "docs/a.md",
      sectionSlug: "goal",
    });
    expect(parseDocumentId("nocciolo:docs/a.md")).toEqual({
      kind: "path",
      documentId: "nocciolo:docs/a.md",
      sourcePath: "docs/a.md",
    });
    expect(parseDocumentId("docs/a.md")).toEqual({
      kind: "path",
      documentId: "docs/a.md",
      sourcePath: "docs/a.md",
    });
    expect(parseDocumentId("session_1")).toEqual({
      kind: "other",
      documentId: "session_1",
    });
  });
});

describe("buildPrunePlan", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "nocciolo-prune-"));
    dirs.push(dir);
    await mkdir(join(dir, "docs"), { recursive: true });
    return dir;
  }

  it("groups path-gone and section-gone without false-positive nocciolo ids", async () => {
    const root = await tempProject();
    await writeFile(
      join(root, "docs", "live.md"),
      "# Goal\n\nThis section stays durable and meaningful enough for extraction.\n\n# Other\n\nAnother durable section about architecture boundaries.\n",
      "utf8",
    );

    const plan = await buildPrunePlan({
      projectRoot: root,
      documentIds: [
        "nocciolo:docs/missing.md#gone",
        "docs/missing-legacy.md",
        "docs/live.md",
        "nocciolo:docs/live.md#goal",
        "nocciolo:docs/live.md#removed-heading",
      ],
    });

    expect(plan.pathGone.map((c) => c.documentId).sort()).toEqual([
      "docs/missing-legacy.md",
      "nocciolo:docs/missing.md#gone",
    ]);
    expect(plan.sectionGone.map((c) => c.documentId)).toEqual([
      "nocciolo:docs/live.md#removed-heading",
    ]);
    expect(
      plan.all.some((c) => c.documentId === "nocciolo:docs/live.md#goal"),
    ).toBe(false);
    expect(plan.all.some((c) => c.documentId === "docs/live.md")).toBe(false);
  });

  it("does not false path-gone nocciolo:path ids when the file still exists", async () => {
    const root = await tempProject();
    await writeFile(
      join(root, "docs", "live.md"),
      "# Goal\n\nThis section stays durable and meaningful enough for extraction.\n",
      "utf8",
    );

    const plan = await buildPrunePlan({
      projectRoot: root,
      documentIds: [
        "nocciolo:docs/live.md",
        "nocciolo:docs/missing-whole.md",
      ],
    });

    expect(plan.pathGone.map((c) => c.documentId)).toEqual([
      "nocciolo:docs/missing-whole.md",
    ]);
    expect(plan.pathGone[0]?.sourcePath).toBe("docs/missing-whole.md");
    expect(plan.all.some((c) => c.documentId === "nocciolo:docs/live.md")).toBe(
      false,
    );
  });

  it("places --source and --document-id into explicit", async () => {
    const root = await tempProject();
    await writeFile(
      join(root, "docs", "live.md"),
      "# Goal\n\nThis section stays durable and meaningful enough for extraction.\n",
      "utf8",
    );

    const plan = await buildPrunePlan({
      projectRoot: root,
      documentIds: [
        "nocciolo:docs/live.md#goal",
        "docs/live.md",
        "nocciolo:docs/other.md#x",
      ],
      source: "docs/live.md",
      documentId: "session_custom",
    });

    expect(plan.explicit.map((c) => c.documentId).sort()).toEqual([
      "docs/live.md",
      "nocciolo:docs/live.md#goal",
      "session_custom",
    ]);
    expect(plan.pathGone.map((c) => c.documentId)).toEqual([
      "nocciolo:docs/other.md#x",
    ]);
  });
});
