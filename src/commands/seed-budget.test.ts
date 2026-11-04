import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KNOWLEDGE_KIND_IDS } from "../judge/knowledge-kinds.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "../judge/types.js";
import type { ResolvedJudge } from "../judge/resolve.js";
import type { HindsightClient } from "../providers/hindsight/client.js";
import { seedManifestPath, type SeedManifest } from "../seeder/manifest.js";
import { runSeed } from "./seed.js";

const BODY =
  "We keep the Hindsight bank on the machine. This architecture decision is a project invariant and a standard for later integrations.";

function doc(title: string, note: string): string {
  return `# ${title}\n\n## Decision\n\n${BODY} ${note}\n`;
}

interface Scores {
  durability: number;
  centrality: number;
  fanout: number;
  supersedes: number;
}

function scoresFor(path: string): Scores {
  if (path.includes("/adr/")) {
    return { durability: 4, centrality: 4, fanout: 4, supersedes: 0.9 };
  }
  if (path.includes("architecture.md")) {
    return { durability: 3, centrality: 3, fanout: 3, supersedes: 0.4 };
  }
  if (path.includes("standards.md")) {
    return { durability: 3, centrality: 3, fanout: 2, supersedes: 0.3 };
  }
  if (path.includes("overview.md")) {
    return { durability: 2, centrality: 2, fanout: 2, supersedes: 0.2 };
  }
  if (path.includes("changelog.md")) {
    return { durability: 0, centrality: 0, fanout: 1, supersedes: 0.05 };
  }
  return { durability: 2, centrality: 1, fanout: 1, supersedes: 0.1 };
}

function kindAnswer(choice: string): JudgeResult["answers"]["kind"] {
  const confidence = 0.93;
  const probabilities: Record<string, number> = {};
  const rest = KNOWLEDGE_KIND_IDS.filter((id) => id !== choice);
  const share = (1 - confidence) / rest.length;
  for (const id of KNOWLEDGE_KIND_IDS) {
    probabilities[id] = id === choice ? confidence : share;
  }
  return { type: "choice", choice, probabilities, confidence };
}

function scoreAnswer(score: number): JudgeResult["answers"][string] {
  return {
    type: "score",
    score,
    legend: { "0": "Low", "4": "High" },
    probabilities: { "0": 0.05, "4": 0.9 },
    confidence: 0.91,
  };
}

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  scoreOf: (path: string) => Scores = scoresFor;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    const state = input.state as { path?: string; text?: string };
    const path = state.path ?? "";
    const scores = this.scoreOf(path);
    const kind = path.includes("changelog.md") ? "historical_context" : "adr";
    return {
      judgeId: "jev",
      model: "jev-1.13.0",
      answers: {
        is_durable: { type: "noul", noul: 0.96 },
        is_ephemeral: { type: "noul", noul: 0.04 },
        in_scope: { type: "noul", noul: 0.93 },
        durability: scoreAnswer(scores.durability),
        centrality: scoreAnswer(scores.centrality),
        agent_fanout: scoreAnswer(scores.fanout),
        supersedes_existing: { type: "noul", noul: scores.supersedes },
        kind: kindAnswer(kind),
        contains_secret: { type: "noul", noul: 0.02 },
        contains_pii: { type: "noul", noul: 0.02 },
      },
    };
  }
}

describe("seed retain budget", () => {
  const dirs: string[] = [];
  let logs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(weights?: Record<string, number>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "nocciolo-seed-budget-"));
    dirs.push(dir);
    await mkdir(join(dir, ".nocciolo", "hindsight"), { recursive: true });
    await mkdir(join(dir, "docs", "adr"), { recursive: true });
    const config: Record<string, unknown> = {
      version: 1,
      name: "fixture",
      provider: "hindsight",
      bankId: "fixture",
      root: ".",
      createdAt: new Date().toISOString(),
      hindsightBaseUrl: "http://localhost:8888",
    };
    if (weights !== undefined) {
      config.judge = { priorityWeights: weights };
    }
    await writeFile(join(dir, ".nocciolo", "config.json"), JSON.stringify(config), "utf8");
    await writeFile(
      join(dir, ".nocciolo", "hindsight", "bank-template.json"),
      JSON.stringify({
        version: "1",
        bank: { retain_mission: "Hold durable decisions for Fixture." },
        mental_models: [],
        directives: [],
      }),
      "utf8",
    );
    await writeFile(
      join(dir, "docs", "adr", "0001-local-bank.md"),
      doc("ADR 0001", "This decision is constitutional."),
      "utf8",
    );
    await writeFile(
      join(dir, "docs", "architecture.md"),
      doc("Architecture", "The module boundary stays local-first."),
      "utf8",
    );
    await writeFile(
      join(dir, "docs", "standards.md"),
      doc("Standards", "Errors stay actionable."),
      "utf8",
    );
    await writeFile(
      join(dir, "docs", "overview.md"),
      doc("Overview", "The CLI is the primary interface."),
      "utf8",
    );
    await writeFile(
      join(dir, "docs", "guide.md"),
      doc("Guide", "Preview with a dry run before retain."),
      "utf8",
    );
    await writeFile(
      join(dir, "docs", "changelog.md"),
      doc("Changelog", "This wording-only changelog lists release notes and does not replace the decision."),
      "utf8",
    );
    return dir;
  }

  function captureLogs(): void {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(" "));
    });
  }

  function resolved(judge: ScriptedJudge): ResolvedJudge {
    return { judgeId: "jev", confidence: 0.8, strict: false, judge };
  }

  function client(): HindsightClient & { retain: ReturnType<typeof vi.fn> } {
    return {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };
  }

  function retainedIds(mock: { retain: ReturnType<typeof vi.fn> }): string[] {
    return mock.retain.mock.calls.flatMap((call) => {
      const request = call[1] as { items?: Array<{ document_id: string }> };
      return (request.items ?? []).map((item) => item.document_id);
    });
  }

  it("prints an ordered queue and a cutoff on dry-run without retaining", async () => {
    const root = await tempProject();
    const judge = new ScriptedJudge();
    const mock = client();
    captureLogs();

    const result = await runSeed({
      cwd: root,
      dryRun: true,
      budget: 5,
      resolvedJudge: resolved(judge),
      client: mock,
      recallObservations: async () => [],
      extractFacts: async () => [],
    });

    const output = logs.join("\n");
    const budget = output.slice(output.indexOf("[dry-run] Retain budget 5"));
    expect(budget).toContain("--- cutoff ---");
    expect(budget.indexOf("docs/adr/0001-local-bank.md")).toBeLessThan(
      budget.indexOf("--- cutoff ---"),
    );
    expect(budget.indexOf("--- cutoff ---")).toBeLessThan(budget.indexOf("docs/changelog.md"));
    expect(output).toMatch(/docs\/changelog\.md#decision.*pending/);
    expect(output).toContain("Would retain 5 candidate(s)");
    expect(result.prepared.factsToRetain).toHaveLength(5);
    expect(result.prepared.factsToRetain.some((fact) => fact.id.includes("changelog.md"))).toBe(
      false,
    );
    expect(mock.retain).not.toHaveBeenCalled();
    expect(judge.calls.some((call) => "centrality" in call.questions)).toBe(true);
    await expect(readFile(seedManifestPath(root), "utf8")).rejects.toThrow();
  });

  it("retains the top candidate and leaves the rest pending for the next seed", async () => {
    const root = await tempProject();
    const judge = new ScriptedJudge();
    const mock = client();
    captureLogs();

    await runSeed({
      cwd: root,
      budget: 1,
      resolvedJudge: resolved(judge),
      client: mock,
      recallObservations: async () => [],
      extractFacts: async () => [],
    });

    expect(retainedIds(mock)).toEqual([
      "nocciolo:docs/adr/0001-local-bank.md#decision",
    ]);
    const first = JSON.parse(await readFile(seedManifestPath(root), "utf8")) as SeedManifest;
    expect(first.sources["docs/adr/0001-local-bank.md"]?.factIds).toEqual([
      "nocciolo:docs/adr/0001-local-bank.md#decision",
    ]);
    expect(first.sources["docs/adr/0001-local-bank.md"]?.pendingFactIds).toBeUndefined();
    expect(first.sources["docs/changelog.md"]?.pendingFactIds).toEqual([
      "nocciolo:docs/changelog.md#decision",
    ]);
    expect(first.sources["docs/changelog.md"]?.factIds).toEqual([]);

    mock.retain.mockClear();
    captureLogs();
    await runSeed({
      cwd: root,
      budget: 5,
      resolvedJudge: resolved(judge),
      client: mock,
      recallObservations: async () => [],
      extractFacts: async () => [],
    });

    const secondIds = retainedIds(mock);
    expect(secondIds).toHaveLength(5);
    expect(secondIds.some((id) => id.includes("0001-local-bank.md"))).toBe(false);
    expect(secondIds.some((id) => id.includes("changelog.md"))).toBe(true);
    const second = JSON.parse(await readFile(seedManifestPath(root), "utf8")) as SeedManifest;
    const pending = Object.values(second.sources).flatMap(
      (source) => source.pendingFactIds ?? [],
    );
    expect(pending).toEqual([]);
    expect(Object.values(second.sources).flatMap((source) => source.factIds)).toHaveLength(6);
  });

  it("ranks with the weights in config", async () => {
    const root = await tempProject({
      durability: 0,
      centrality: 0,
      supersession: 0,
      fanout: 1,
      secretRisk: 0,
    });
    const judge = new ScriptedJudge();
    judge.scoreOf = (path) =>
      path.includes("changelog.md")
        ? { durability: 0, centrality: 0, fanout: 4, supersedes: 0 }
        : { durability: 4, centrality: 4, fanout: 0, supersedes: 0 };
    captureLogs();

    await runSeed({
      cwd: root,
      dryRun: true,
      budget: 5,
      resolvedJudge: resolved(judge),
      recallObservations: async () => [],
      extractFacts: async () => [],
    });

    const output = logs.join("\n");
    const budget = output.slice(output.indexOf("[dry-run] Retain budget 5"));
    expect(budget.indexOf("docs/changelog.md")).toBeLessThan(
      budget.indexOf("docs/adr/0001-local-bank.md"),
    );
    expect(budget).toContain("fanout=1.00");
  });

  it("rejects a budget without --judge jev", async () => {
    await expect(runSeed({ budget: 5, judge: "heuristic" })).rejects.toThrow(
      /requires --judge jev/,
    );
  });
});
