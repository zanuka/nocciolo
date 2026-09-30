import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { findDurableSources } from "./durable-sources.js";

describe("findDurableSources", () => {
  it("finds README, docs, and ADRs; skips AGENTS.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "nocciolo-scan-"));
    await writeFile(join(root, "README.md"), "# Hello\n");
    await writeFile(join(root, "AGENTS.md"), "# Agents\n");
    await mkdir(join(root, "docs", "adr"), { recursive: true });
    await writeFile(join(root, "docs", "guide.md"), "# Guide\n");
    await writeFile(join(root, "docs", "adr", "0001-use-ts.md"), "# ADR\n");

    const sources = await findDurableSources(root);
    const paths = sources.map((s) => s.relativePath).sort();

    expect(paths).toEqual([
      "README.md",
      "docs/adr/0001-use-ts.md",
      "docs/guide.md",
    ]);
  });

  it("excludes sensitive paths even under docs/", async () => {
    const root = await mkdtemp(join(tmpdir(), "nocciolo-scan-sens-"));
    await writeFile(join(root, "README.md"), "# Hello\n");
    await mkdir(join(root, "docs", "secrets"), { recursive: true });
    await writeFile(join(root, "docs", "guide.md"), "# Guide\n");
    await writeFile(join(root, "docs", "credentials.md"), "password=nope\n");
    await writeFile(join(root, "docs", "api-keys.md"), "key=nope\n");
    await writeFile(join(root, "docs", "secrets", "tokens.md"), "token=nope\n");
    await writeFile(join(root, ".env"), "SECRET=1\n");
    await writeFile(join(root, "credentials.json"), '{"x":1}\n');

    const sources = await findDurableSources(root);
    const paths = sources.map((s) => s.relativePath).sort();

    expect(paths).toEqual(["README.md", "docs/guide.md"]);
  });

  it("uses include and exclude globs, including mdx, and still denies secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "nocciolo-scan-policy-"));
    await writeFile(join(root, "README.md"), "# Hello\n");
    await mkdir(join(root, "docs", "interviews", "panel-2", "slides"), { recursive: true });
    await mkdir(join(root, "docs", "secrets"), { recursive: true });
    await mkdir(join(root, "src", "content", "works"), { recursive: true });
    await writeFile(join(root, "docs", "guide.md"), "# Guide\n");
    await writeFile(join(root, "docs", "interviews", "notes.md"), "# Notes\n");
    await writeFile(
      join(root, "docs", "interviews", "panel-2", "slides", "slides.md"),
      "# Slides\n",
    );
    await writeFile(join(root, "docs", "secrets", "tokens.md"), "token=nope\n");
    await writeFile(join(root, "src", "content", "works", "nike.mdx"), "# Nike\n");
    await writeFile(join(root, "src", "content", "works", "_draft.mdx"), "# Draft\n");

    const sources = await findDurableSources(root, {
      include: ["docs/**/*.md", "src/content/works/**/*.mdx"],
      exclude: ["docs/interviews/panel-2/**", "**/_*.mdx"],
      extensions: [".md", ".markdown", ".mdx"],
    });
    const paths = sources.map((s) => s.relativePath).sort();

    expect(paths).toEqual([
      "docs/guide.md",
      "docs/interviews/notes.md",
      "src/content/works/nike.mdx",
    ]);
    expect(sources.find((s) => s.relativePath.endsWith("nike.mdx"))?.kind).toBe("docs");
  });

  it("keeps the default scan when include is omitted, and applies exclude", async () => {
    const root = await mkdtemp(join(tmpdir(), "nocciolo-scan-exclude-"));
    await writeFile(join(root, "README.md"), "# Hello\n");
    await mkdir(join(root, "docs", "interviews", "panel-2"), { recursive: true });
    await writeFile(join(root, "docs", "guide.md"), "# Guide\n");
    await writeFile(join(root, "docs", "interviews", "panel-2", "slides.md"), "# Slides\n");

    const sources = await findDurableSources(root, {
      exclude: ["docs/interviews/panel-2/**"],
    });

    expect(sources.map((s) => s.relativePath).sort()).toEqual([
      "README.md",
      "docs/guide.md",
    ]);
  });
});
