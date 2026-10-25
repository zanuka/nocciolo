import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "../judge/types.js";
import type { ResolvedJudge } from "../judge/resolve.js";
import type { HindsightClient } from "../providers/hindsight/client.js";
import { seedManifestPath } from "../seeder/manifest.js";
import { runSeed } from "./seed.js";

const ADR = `# ADR 0001: Keep the bank local

## Decision

We keep the Hindsight bank on the machine. This architecture decision is a project invariant and a standard for later integrations.
`;

const CHANGELOG = `# Changelog

## Notes

This generated changelog is a badge wall and a table of contents. The dump mentions the module architecture so a keyword filter keeps the section. It is still a TODO pile.
`;

const BADGES = `# Status

## Shields

This badge wall lists generated status images for the module architecture. It is not a decision or a standard. The section is long enough to clear the heuristic floor.
`;

const TOC = `# Guide

## Map

Table of contents for the generated pages. The word architecture appears here so the heuristic keeps the section. These links are navigation only and not a standard.
`;

const WORKSHOP = `# Notes

## Workshop

Workshop notes from a design session. We discussed the module architecture and whether it belongs in the bank. The section is long enough for the heuristic filter to keep it.
`;

const MIXED_README = `# Fixture

## Architecture

The module boundary is a local-first architecture decision. We chose to keep the Hindsight bank on the machine. This invariant is a project standard for later integrations.

## Changelog

This generated changelog is a badge wall and a table of contents. The notes are a TODO pile, not a decision or a standard.
`;

function answersFor(text: string): JudgeResult {
  const ephemeral = /changelog|badge wall|table of contents/i.test(text);
  const uncertain = /workshop notes/i.test(text);
  const noul = uncertain ? 0.55 : ephemeral ? 0.05 : 0.96;
  const flipped = uncertain ? 0.55 : ephemeral ? 0.97 : 0.04;
  return {
    judgeId: "jev",
    model: "jev-1.13.0",
    answers: {
      is_durable: { type: "noul", noul },
      is_ephemeral: { type: "noul", noul: flipped },
      in_scope: { type: "noul", noul: uncertain ? 0.55 : 0.93 },
      durability: {
        type: "score",
        score: ephemeral ? 0 : uncertain ? 2 : 4,
        legend: { "0": "Ephemeral", "4": "Constitutional" },
        probabilities: { "0": ephemeral ? 0.9 : 0.1 },
        confidence: uncertain ? 0.4 : 0.91,
      },
    },
  };
}

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    const state = input.state as { path?: string; text?: string };
    return answersFor(`${state.path ?? ""}\n${state.text ?? ""}`);
  }
}

describe("seed relevance gate", () => {
  const dirs: string[] = [];
  let logs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "nocciolo-seed-jev-"));
    dirs.push(dir);
    await mkdir(join(dir, ".nocciolo", "hindsight"), { recursive: true });
    await mkdir(join(dir, "docs", "adr"), { recursive: true });
    await writeFile(
      join(dir, ".nocciolo", "config.json"),
      JSON.stringify({
        version: 1,
        name: "fixture",
        provider: "hindsight",
        bankId: "fixture",
        root: ".",
        createdAt: new Date().toISOString(),
        hindsightBaseUrl: "http://localhost:8888",
      }),
      "utf8",
    );
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
    await writeFile(join(dir, "docs", "adr", "0001-local-bank.md"), ADR, "utf8");
    await writeFile(join(dir, "docs", "changelog.md"), CHANGELOG, "utf8");
    await writeFile(join(dir, "docs", "badges.md"), BADGES, "utf8");
    await writeFile(join(dir, "docs", "contents.md"), TOC, "utf8");
    await writeFile(join(dir, "docs", "notes.md"), WORKSHOP, "utf8");
    return dir;
  }

  function captureLogs(): void {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(" "));
    });
  }

  function retainedIds(client: { retain: ReturnType<typeof vi.fn> }): string[] {
    return client.retain.mock.calls.flatMap((call) => {
      const request = call[1] as { items?: Array<{ document_id: string }> };
      return (request.items ?? []).map((item) => item.document_id);
    });
  }

  it("prints path, heading, decisions, scores, confidence, and heuristic-vs-jev on dry-run", async () => {
    const root = await tempProject();
    const judge = new ScriptedJudge();
    const resolved: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    captureLogs();

    const result = await runSeed({
      cwd: root,
      dryRun: true,
      resolvedJudge: resolved,
    });

    const output = logs.join("\n");
    expect(output).toContain("document_id:");
    expect(output).toContain("path: docs/adr/0001-local-bank.md");
    expect(output).toContain("heading:");
    expect(output).toContain("heuristic-vs-jev:");
    expect(output).toContain("is_durable:");
    expect(output).toContain("is_ephemeral:");
    expect(output).toContain("in_scope:");
    expect(output).toContain("score: durability=");
    expect(output).toContain("confidence=");
    expect(output).toContain("decision:");
    expect(output).toMatch(/bank mission: Hold durable decisions for Fixture\./);

    const actions = new Map(
      result.relevance?.rows.map((row) => [row.fact.provenance.sourcePath, row.action]),
    );
    expect(actions.get("docs/adr/0001-local-bank.md")).toBe("retain");
    expect(actions.get("docs/changelog.md")).toBe("skip");
    expect(actions.get("docs/badges.md")).toBe("skip");
    expect(actions.get("docs/contents.md")).toBe("skip");
    expect(actions.get("docs/notes.md")).toBe("review");
    expect(
      result.prepared.factsToRetain.every(
        (fact) => fact.provenance.sourcePath === "docs/adr/0001-local-bank.md",
      ),
    ).toBe(true);
    expect(result.prepared.factsToRetain.length).toBeGreaterThan(0);
    expect(judge.calls.length).toBeGreaterThan(0);
    expect(Object.keys(judge.calls[0]?.questions ?? {})).toEqual([
      "is_durable",
      "is_ephemeral",
      "in_scope",
      "durability",
    ]);
    const state = judge.calls.find((call) => {
      const body = call.state as { path?: string };
      return body.path === "docs/adr/0001-local-bank.md";
    })?.state as { text?: string; bankMission?: string };
    expect(state.bankMission).toBe("Hold durable decisions for Fixture.");
    expect(state.text).toMatch(/architecture decision/);
  });

  it("live seed retains the ADR and skips only high-confidence rejects", async () => {
    const root = await tempProject();
    const judge = new ScriptedJudge();
    const resolved: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    const client = {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };
    captureLogs();

    const result = await runSeed({
      cwd: root,
      resolvedJudge: resolved,
      client,
    });

    const ids = retainedIds(client);
    expect(ids.some((id) => id.includes("docs/adr/0001-local-bank.md"))).toBe(true);
    expect(ids.some((id) => id.includes("docs/changelog.md"))).toBe(false);
    expect(ids.some((id) => id.includes("docs/badges.md"))).toBe(false);
    expect(ids.some((id) => id.includes("docs/contents.md"))).toBe(false);
    expect(ids.some((id) => id.includes("docs/notes.md"))).toBe(false);
    expect(result.relevance?.rows.some((row) => row.action === "skip")).toBe(true);
    expect(
      result.relevance?.rows.find((row) => row.fact.provenance.sourcePath === "docs/notes.md")
        ?.action,
    ).toBe("review");
    expect(result.retained).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("keeps heuristic candidates when --judge jev is omitted", async () => {
    const root = await tempProject();
    const client = {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };
    captureLogs();

    const result = await runSeed({
      cwd: root,
      client,
    });

    const ids = retainedIds(client);
    expect(result.relevance).toBeUndefined();
    expect(ids.some((id) => id.includes("docs/adr/0001-local-bank.md"))).toBe(true);
    expect(ids.some((id) => id.includes("docs/changelog.md"))).toBe(true);
    expect(ids.some((id) => id.includes("docs/badges.md"))).toBe(true);
    expect(ids.some((id) => id.includes("docs/contents.md"))).toBe(true);
    expect(ids.some((id) => id.includes("docs/notes.md"))).toBe(true);
  });

  it("dry-run shows one row per README section and retains only the architecture section", async () => {
    const root = await tempProject();
    await writeFile(join(root, "README.md"), MIXED_README, "utf8");
    const judge = new ScriptedJudge();
    const resolved: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    captureLogs();

    const result = await runSeed({
      cwd: root,
      dryRun: true,
      resolvedJudge: resolved,
    });

    const output = logs.join("\n");
    const readmeRows =
      result.relevance?.rows.filter(
        (row) => row.fact.provenance.sourcePath === "README.md",
      ) ?? [];
    expect(readmeRows.map((row) => [row.fact.id, row.action])).toEqual([
      ["nocciolo:README.md#architecture", "retain"],
      ["nocciolo:README.md#changelog", "skip"],
    ]);
    expect(output).toContain("document_id: nocciolo:README.md#architecture");
    expect(output).toContain("document_id: nocciolo:README.md#changelog");
    expect(output).toContain("heading: Architecture");
    expect(output).toContain("heading: Changelog");
    expect(output).toMatch(
      /document_id: nocciolo:README.md#changelog[\s\S]*?heuristic: skip/,
    );

    const readmeCalls = judge.calls.filter((call) => {
      const state = call.state as { path?: string };
      return state.path === "README.md";
    });
    expect(readmeCalls).toHaveLength(2);
    const architecture = readmeCalls.find((call) => {
      const state = call.state as { heading?: string };
      return state.heading === "Architecture";
    })?.state as { text?: string };
    const changelog = readmeCalls.find((call) => {
      const state = call.state as { heading?: string };
      return state.heading === "Changelog";
    })?.state as { text?: string };
    expect(architecture.text).toMatch(/local-first/);
    expect(architecture.text).not.toMatch(/badge wall/);
    expect(changelog.text).toMatch(/changelog/i);
    expect(changelog.text).not.toMatch(/local-first/);

    const ids = result.prepared.factsToRetain.map((fact) => fact.id);
    expect(ids).toContain("nocciolo:README.md#architecture");
    expect(ids).not.toContain("nocciolo:README.md#changelog");
  });

  it("live seed retains the README architecture section and skips its changelog section", async () => {
    const root = await tempProject();
    await writeFile(join(root, "README.md"), MIXED_README, "utf8");
    const judge = new ScriptedJudge();
    const resolved: ResolvedJudge = {
      judgeId: "jev",
      confidence: 0.8,
      strict: false,
      judge,
    };
    const client = {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };

    const result = await runSeed({
      cwd: root,
      resolvedJudge: resolved,
      client,
    });

    const ids = retainedIds(client);
    expect(ids).toContain("nocciolo:README.md#architecture");
    expect(ids).not.toContain("nocciolo:README.md#changelog");
    expect(
      result.relevance?.rows.find((row) => row.fact.id === "nocciolo:README.md#changelog")
        ?.action,
    ).toBe("skip");

    const manifest = JSON.parse(await readFile(seedManifestPath(root), "utf8")) as {
      sources: Record<string, { factIds: string[] }>;
    };
    expect(manifest.sources["README.md"]?.factIds).toContain(
      "nocciolo:README.md#architecture",
    );
    expect(manifest.sources["README.md"]?.factIds ?? []).not.toContain(
      "nocciolo:README.md#changelog",
    );
  });

  it("leaves the changelog section out when --judge jev is omitted", async () => {
    const root = await tempProject();
    await writeFile(join(root, "README.md"), MIXED_README, "utf8");
    const client = {
      retain: vi.fn(async () => ({ success: true })),
    } as unknown as HindsightClient & { retain: ReturnType<typeof vi.fn> };

    const result = await runSeed({
      cwd: root,
      client,
    });

    const ids = retainedIds(client);
    expect(result.relevance).toBeUndefined();
    expect(ids).toContain("nocciolo:README.md#architecture");
    expect(ids).not.toContain("nocciolo:README.md#changelog");
  });
});
