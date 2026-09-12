import {
  assertDockerAvailable,
  formatDockerArgv,
  getContainerStatus,
  runDockerCommand,
  type RunDockerResult,
} from "./hindsight.js";
import {
  parseDockerInspect,
  type InspectedHindsightContainer,
} from "./upgrade.js";
import { NoccioloError } from "../utils/errors.js";
import { HindsightInstanceClient } from "../providers/hindsight/instance.js";

export async function inspectHindsightContainer(
  containerName: string,
  run: typeof runDockerCommand = runDockerCommand,
): Promise<InspectedHindsightContainer> {
  const result = await run(
    ["docker", "inspect", containerName],
    { allowFailure: true },
  );
  if (result.exitCode !== 0) {
    throw new NoccioloError(
      `Could not inspect container "${containerName}"`,
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Ensure Docker is running and the container exists (`nocciolo docker status`).",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new NoccioloError(
      `docker inspect for "${containerName}" returned invalid JSON`,
      "Re-run `docker inspect <container>` manually and confirm the container exists.",
    );
  }
  return parseDockerInspect(parsed, containerName);
}

export async function pullHindsightImage(
  image: string,
  run: typeof runDockerCommand = runDockerCommand,
): Promise<void> {
  await run(["docker", "pull", image]);
}

export async function stopAndRemoveContainer(
  containerName: string,
  run: typeof runDockerCommand = runDockerCommand,
): Promise<void> {
  await run(["docker", "rm", "-f", containerName], { allowFailure: true });
}

export async function waitForHindsightHealth(options: {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  containerName?: string;
}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const clientOptions: {
    baseUrl: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
  } = {
    baseUrl: options.baseUrl,
  };
  if (options.apiKey !== undefined) {
    clientOptions.apiKey = options.apiKey;
  }
  if (options.fetchImpl !== undefined) {
    clientOptions.fetchImpl = options.fetchImpl;
  }
  const client = new HindsightInstanceClient(clientOptions);
  const started = Date.now();
  let lastError: unknown;

  while (Date.now() - started < timeoutMs) {
    try {
      const health = await client.getHealth();
      if (client.isHealthy(health)) {
        return;
      }
      lastError = new Error(`unhealthy: ${JSON.stringify(health)}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }

  const logsHint = options.containerName
    ? `Check logs with: docker logs --tail 80 ${options.containerName}`
    : "Check docker logs for the Hindsight container.";

  throw new NoccioloError(
    `Hindsight did not become healthy within ${Math.round(timeoutMs / 1000)}s at ${options.baseUrl}`,
    `${logsHint} Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export async function runAdminBackup(options: {
  containerName: string;
  containerZipPath: string;
  hostZipPath: string;
  run?: typeof runDockerCommand;
}): Promise<boolean> {
  const run = options.run ?? runDockerCommand;
  const which = await run(
    ["docker", "exec", options.containerName, "which", "hindsight-admin"],
    { allowFailure: true },
  );
  if (which.exitCode !== 0) {
    return false;
  }

  await run([
    "docker",
    "exec",
    options.containerName,
    "hindsight-admin",
    "backup",
    options.containerZipPath,
  ]);

  await run([
    "docker",
    "cp",
    `${options.containerName}:${options.containerZipPath}`,
    options.hostZipPath,
  ]);
  return true;
}

export async function verifyTarballNonEmpty(
  hostTarballPath: string,
  run: typeof runDockerCommand = runDockerCommand,
): Promise<number> {
  const result = await run(
    ["tar", "tzf", hostTarballPath],
    { allowFailure: true },
  );
  if (result.exitCode !== 0) {
    throw new NoccioloError(
      `Failed to list volume tarball at ${hostTarballPath}`,
      result.stderr.trim() ||
        "Backup tarball may be corrupt. Aborting upgrade.",
    );
  }
  const count = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
  if (count <= 0) {
    throw new NoccioloError(
      `Volume tarball is empty: ${hostTarballPath}`,
      "Aborting upgrade. Re-run backup or fix Docker volume mounts.",
    );
  }
  return count;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export {
  assertDockerAvailable,
  formatDockerArgv,
  getContainerStatus,
  runDockerCommand,
  type RunDockerResult,
};
