import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMcp } from "./mcp.js";

describe("runMcp --write-firstmate", () => {
  const dirs: string[] = [];
  const originalFmHome = process.env.FM_HOME;

  afterEach(async () => {
    if (originalFmHome === undefined) {
      delete process.env.FM_HOME;
    } else {
      process.env.FM_HOME = originalFmHome;
    }
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  async function tempProject(): Promise<string> {
    const root = await tempDir("nocciolo-mcp-project-");
    await mkdir(join(root, ".nocciolo"), { recursive: true });
    await writeFile(
      join(root, ".nocciolo", "config.json"),
      JSON.stringify({
        version: 1,
        name: "fixture",
        provider: "hindsight",
        bankId: "fixture-bank",
        root: ".",
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );
    return root;
  }

  it("prints install steps and writes nothing when FM_HOME is unset", async () => {
    delete process.env.FM_HOME;
    const root = await tempProject();

    const result = await runMcp({
      cwd: root,
      harness: "firstmate",
      writeFirstmate: true,
    });

    expect(result.firstmateSkill?.printOnly).toBe(true);
    expect(result.firstmateSkill?.installed).toBe(false);
  });

  it("writes the skill file and registry entry under FM_HOME", async () => {
    const fmHome = await tempDir("nocciolo-fm-home-");
    process.env.FM_HOME = fmHome;
    const root = await tempProject();

    const result = await runMcp({
      cwd: root,
      harness: "firstmate",
      writeFirstmate: true,
    });

    expect(result.firstmateSkill?.installed).toBe(true);
    const skillPath = join(fmHome, ".agents", "skills", "project-bank", "SKILL.md");
    const skill = await readFile(skillPath, "utf8");
    expect(skill).toContain("project-bank");
    expect(skill).toContain("recall");

    const registryPath = join(fmHome, ".nocciolo", "projects.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as {
      projects: Record<string, { bankId: string; hindsightBaseUrl?: string }>;
    };
    expect(registry.projects[root]).toMatchObject({ bankId: "fixture-bank" });
  });

  it("dry-run previews without writing", async () => {
    const fmHome = await tempDir("nocciolo-fm-home-");
    process.env.FM_HOME = fmHome;
    const root = await tempProject();

    const result = await runMcp({
      cwd: root,
      harness: "firstmate",
      writeFirstmate: true,
      dryRun: true,
    });

    expect(result.firstmateSkill?.dryRun).toBe(true);
    expect(result.firstmateSkill?.installed).toBe(false);
    await expect(
      readFile(join(fmHome, ".agents", "skills", "project-bank", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("does not write into the product repo tree", async () => {
    const fmHome = await tempDir("nocciolo-fm-home-");
    process.env.FM_HOME = fmHome;
    const root = await tempProject();

    await runMcp({ cwd: root, harness: "firstmate", writeFirstmate: true });

    await expect(
      readFile(join(root, ".agents", "skills", "project-bank", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
  });
});
