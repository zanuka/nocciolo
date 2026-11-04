import type { WatcherGateDecision } from "../judge/watcher-gate.js";

export interface WatcherSeedEnqueue {
  paths: string[];
  decisions: WatcherGateDecision[];
}

export function collectSeedEnqueue(
  decisions: readonly WatcherGateDecision[],
): WatcherSeedEnqueue | undefined {
  const enqueued = decisions.filter((decision) => decision.verdict === "enqueue");
  if (enqueued.length === 0) {
    return undefined;
  }
  return {
    paths: enqueued.map((decision) => decision.path),
    decisions: [...enqueued],
  };
}
