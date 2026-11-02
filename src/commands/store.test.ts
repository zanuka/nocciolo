import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { KNOWLEDGE_KIND_IDS } from "../judge/knowledge-kinds.js";
import type { ChoiceAnswer, Judge, JudgeEvaluateInput, JudgeResult } from "../judge/types.js";
import type { ResolvedJudge } from "../judge/resolve.js";
import { runStore } from "./store.js";

const execFileAsync = promisify(execFile);

describe("runStore", () => {
  const dirs: string[] = [];
  const originalFmHome = process.env.FM_HOME;

  beforeEach(() => {
    process.env.FM_HOME = "/dev/null/no-fm-home-in-tests";
  });

  afterEach(async () => {
    if (originalFmHome === undefined) {
      delete process.env.FM_HOME;
    } else {
      process.env.FM_HOME = originalFmHome;
    }
    vi.unstubAllGlobals();
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "nocciolo-store-"));
    dirs.push(dir);
    return dir;
  }

  async function writeConfig(
    root: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
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
        ...overrides,
      }),
      "utf8",
    );
  }

  function stubRetainSuccess(): void {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ success: true, bank_id: "fixture-bank", items_count: 1 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchImpl);
  }

  it("dry-run lists known/new/changed/unchanged with explicit zeros and never calls Hindsight", async () => {
    const root = await tempProject();
    await writeConfig(root);
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runStore({ cwd: root, dryRun: true });

    expect(result.buckets.known).toHaveLength(0);
    expect(result.buckets.new).toHaveLength(0);
    expect(result.buckets.changed).toHaveLength(0);
    expect(result.buckets.unchanged).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lists a durable file as new when it is not yet allowlisted", async () => {
    const root = await tempProject();
    await writeConfig(root);
    await writeFile(join(root, "README.md"), "# Fixture\n\nSome durable overview content here.");

    const result = await runStore({ cwd: root, dryRun: true });

    expect(result.buckets.new.map((b) => b.relativePath)).toEqual(["README.md"]);
    expect(result.buckets.known).toHaveLength(0);
  });

  it("--add-files updates the allowlist only, without retaining", async () => {
    const root = await tempProject();
    await writeConfig(root);
    await writeFile(join(root, "README.md"), "# Fixture\n\nSome durable overview content here.");
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runStore({ cwd: root, addFiles: "README.md" });

    expect(result.addFilesOnly).toBe(true);
    expect(result.addedToAllowlist).toEqual(["README.md"]);
    expect(result.retained).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();

    const config = JSON.parse(
      await readFile(join(root, ".nocciolo", "config.json"), "utf8"),
    ) as { store?: { allowlist: string[] } };
    expect(config.store?.allowlist).toEqual(["README.md"]);
  });

  it("--files allowlists and retains the given file; a later dry-run shows it as known", async () => {
    const root = await tempProject();
    await writeConfig(root);
    await writeFile(
      join(root, "README.md"),
      "# Fixture\n\n## Architecture\n\nThis module owns retain boundaries and stays separate from scanning.",
    );
    stubRetainSuccess();

    const stored = await runStore({
      cwd: root,
      files: "README.md",
      apiKey: "test-key",
    });

    expect(stored.retained).toBeGreaterThan(0);
    const config = JSON.parse(
      await readFile(join(root, ".nocciolo", "config.json"), "utf8"),
    ) as { store?: { allowlist: string[] } };
    expect(config.store?.allowlist).toEqual(["README.md"]);

    const laterDryRun = await runStore({ cwd: root, dryRun: true });
    expect(laterDryRun.buckets.known.map((b) => b.relativePath)).toEqual([
      "README.md",
    ]);
    expect(laterDryRun.buckets.unchanged.map((b) => b.relativePath)).toEqual([
      "README.md",
    ]);
    expect(laterDryRun.buckets.new).toHaveLength(0);
  });

  it("--yes stores changed known files only and skips new files without adopting them", async () => {
    const root = await tempProject();
    await writeConfig(root, { store: { allowlist: ["README.md"] } });
    await writeFile(
      join(root, "README.md"),
      "# Fixture\n\n## Architecture\n\nThis module owns retain boundaries.",
    );
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, "docs", "NEW.md"),
      "# New doc\n\n## Architecture\n\nA brand new durable doc not yet allowlisted.",
    );
    stubRetainSuccess();

    const result = await runStore({ cwd: root, yes: true, apiKey: "test-key" });

    expect(result.skippedNew).toEqual(["docs/NEW.md"]);
    expect(result.selected).toEqual(["README.md"]);

    const config = JSON.parse(
      await readFile(join(root, ".nocciolo", "config.json"), "utf8"),
    ) as { store?: { allowlist: string[] } };
    expect(config.store?.allowlist).toEqual(["README.md"]);
  });

  it("denylist wins: refuses to allowlist a secrets-shaped path even with --add-files", async () => {
    const root = await tempProject();
    await writeConfig(root);
    await mkdir(join(root, "secrets"), { recursive: true });
    await writeFile(join(root, "secrets", "api-keys.md"), "shh");

    await expect(
      runStore({ cwd: root, addFiles: "secrets/api-keys.md" }),
    ).rejects.toThrow(/Refusing to allowlist/);
  });

  it("denylist wins: refuses --files for a non-markdown path", async () => {
    const root = await tempProject();
    await writeConfig(root);
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfile");

    await expect(
      runStore({ cwd: root, files: "pnpm-lock.yaml" }),
    ).rejects.toThrow(/Refusing to store/);
  });

  it("never stores from a disposable git worktree", async () => {
    const durable = await tempProject();
    await execFileAsync("git", ["init", "-q"], { cwd: durable });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: durable,
    });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: durable });
    await writeConfig(durable);
    await writeFile(join(durable, ".gitignore"), "node_modules\n");
    await execFileAsync("git", ["add", "-A"], { cwd: durable });
    await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: durable });

    const worktreeParent = await tempProject();
    const worktreePath = join(worktreeParent, "linked");
    await execFileAsync(
      "git",
      ["worktree", "add", "-b", "wt-branch", worktreePath],
      { cwd: durable },
    );

    await expect(runStore({ cwd: worktreePath, dryRun: true })).rejects.toThrow(
      /disposable git worktree/,
    );
  });

  it("proposes a new ADR and does not propose a dependency readme or scratch markdown", async () => {
    const root = await tempProject();
    await writeConfig(root, { store: { allowlist: [] } });
    await mkdir(join(root, "docs", "adr"), { recursive: true });
    await mkdir(join(root, "node_modules", "left-pad"), { recursive: true });
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(
      join(root, "docs", "adr", "0002-keep-local.md"),
      "# ADR 0002\n\n## Decision\n\nWe keep the Hindsight bank on the machine. This is a project invariant.\n",
    );
    await writeFile(
      join(root, "docs", "scratch.md"),
      "# Scratch\n\nTODO dump and a badge wall. Not a decision.\n",
    );
    await writeFile(
      join(root, "node_modules", "left-pad", "README.md"),
      "# left-pad\n\nA dependency readme.\n",
    );
    await writeFile(join(root, "notes", "random.md"), "# Random\n\nMeeting notes.\n");
    const calls: string[] = [];
    const judge: Judge = {
      id: "jev",
      async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
        const path = (input.state as { path?: string }).path ?? "";
        calls.push(path);
        const adopt = path.includes("docs/adr/");
        return {
          judgeId: "jev",
          answers: {
            should_adopt: { type: "noul", noul: adopt ? 0.96 : 0.04 },
            kind: adoptKind(adopt ? "adr" : "noise", adopt ? 0.93 : 0.95),
          },
        };
      },
    };
    const resolvedJudge: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runStore({
      cwd: root,
      proposeAdopt: true,
      resolvedJudge,
    });

    expect(calls.sort()).toEqual([
      "docs/adr/0002-keep-local.md",
      "docs/scratch.md",
    ]);
    expect(result.proposals?.filter((proposal) => proposal.verdict === "propose").map((proposal) => proposal.path)).toEqual([
      "docs/adr/0002-keep-local.md",
    ]);
    expect(result.addedToAllowlist).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    const config = JSON.parse(
      await readFile(join(root, ".nocciolo", "config.json"), "utf8"),
    ) as { store?: { allowlist: string[] } };
    expect(config.store?.allowlist).toEqual([]);
  });

  it("--apply writes only the proposed ADR and does not retain", async () => {
    const root = await tempProject();
    await writeConfig(root, { store: { allowlist: [] } });
    await mkdir(join(root, "docs", "adr"), { recursive: true });
    await writeFile(
      join(root, "docs", "adr", "0002-keep-local.md"),
      "# ADR 0002\n\n## Decision\n\nWe keep the Hindsight bank on the machine.\n",
    );
    const judge: Judge = {
      id: "jev",
      async evaluate(): Promise<JudgeResult> {
        return {
          judgeId: "jev",
          answers: {
            should_adopt: { type: "noul", noul: 0.96 },
            kind: adoptKind("adr", 0.93),
          },
        };
      },
    };
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const resolvedJudge: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };

    const preview = await runStore({
      cwd: root,
      proposeAdopt: true,
      apply: true,
      dryRun: true,
      resolvedJudge,
    });
    expect(preview.addedToAllowlist).toEqual([]);
    let config = JSON.parse(
      await readFile(join(root, ".nocciolo", "config.json"), "utf8"),
    ) as { store?: { allowlist: string[] } };
    expect(config.store?.allowlist).toEqual([]);

    const result = await runStore({
      cwd: root,
      proposeAdopt: true,
      apply: true,
      resolvedJudge,
    });

    expect(result.addedToAllowlist).toEqual(["docs/adr/0002-keep-local.md"]);
    expect(result.retained).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    config = JSON.parse(
      await readFile(join(root, ".nocciolo", "config.json"), "utf8"),
    ) as { store?: { allowlist: string[] } };
    expect(config.store?.allowlist).toEqual(["docs/adr/0002-keep-local.md"]);
  });
});

function adoptKind(choice: string, confidence: number): ChoiceAnswer {
  const probabilities: Record<string, number> = {};
  const rest = KNOWLEDGE_KIND_IDS.filter((id) => id !== choice);
  const share = (1 - confidence) / rest.length;
  for (const id of KNOWLEDGE_KIND_IDS) {
    probabilities[id] = id === choice ? confidence : share;
  }
  return { type: "choice", choice, probabilities, confidence };
}
