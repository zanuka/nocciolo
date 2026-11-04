import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WatcherGateDecision } from "../judge/watcher-gate.js";
import { collectSeedEnqueue } from "./enqueue.js";

describe("watcher seed enqueue", () => {
  it("collects only enqueue verdicts", () => {
    const decisions: WatcherGateDecision[] = [
      {
        path: "docs/adr/0001.md",
        verdict: "enqueue",
        reason: "durable claim changed with high behavior delta",
      },
      {
        path: "docs/changelog.md",
        verdict: "skip",
        reason: "durable claim unchanged",
      },
      {
        path: "docs/notes.md",
        verdict: "review",
        reason: "watcher gate below 0.80",
      },
    ];
    expect(collectSeedEnqueue(decisions)).toEqual({
      paths: ["docs/adr/0001.md"],
      decisions: [decisions[0]],
    });
    expect(collectSeedEnqueue(decisions.slice(1))).toBeUndefined();
  });

  it("keeps the watcher out of the default CLI surface", () => {
    const cli = readFileSync(join(process.cwd(), "src/cli.ts"), "utf8");
    expect(cli).not.toMatch(/\.command\(\s*["']watch["']/);
    expect(cli).not.toMatch(/runWatch/);
  });
});
