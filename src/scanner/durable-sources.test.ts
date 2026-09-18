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
});
