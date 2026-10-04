import { loadConfig, loadShareConfig } from "../config/load.js";
import { resolveDeploymentProfile } from "../config/connection.js";
import { defaultVolumeName } from "../config/schema.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  assertDockerAvailable,
  buildDockerStopPlan,
  buildDockerUpPlan,
  getContainerStatus,
  resolveLlmApiKey,
  resolveLlmApiKeyDisplay,
  runDockerCommand,
  DEFAULT_CONTAINER_NAME,
  DEFAULT_VOLUME_NAME,
} from "../docker/hindsight.js";
import { NoccioloError } from "../utils/errors.js";

export type DockerAction = "up" | "down" | "status" | "print";

export interface DockerCommandOptions {
  action?: DockerAction;
  dryRun?: boolean;
  cwd?: string;
  containerName?: string;
  volumeName?: string;
  apiPort?: number;
  uiPort?: number;
  image?: string;
  llmApiKey?: string;
  llmProvider?: string;
  apiKey?: string;
  pull?: boolean;
  detach?: boolean;
}

export interface DockerCommandResult {
  action: DockerAction;
  dryRun: boolean;
  display: string;
  containerName: string;
  apiUrl: string;
  uiUrl: string;
  envHints: string[];
  statusLine?: string;
  executed: boolean;
}

export async function resolveDockerNames(options: {
  cwd?: string;
  containerName?: string;
  volumeName?: string;
}): Promise<{ containerName: string; volumeName: string }> {
  if (options.containerName !== undefined) {
    const containerName = options.containerName;
    return {
      containerName,
      volumeName:
        options.volumeName ?? defaultVolumeName(containerName),
    };
  }

  try {
    const projectRoot = await detectProjectRoot(options.cwd ?? process.cwd());
    const config = await loadConfig(projectRoot);
    if (config.docker?.containerName) {
      const containerName = config.docker.containerName;
      return {
        containerName,
        volumeName:
          options.volumeName ??
          config.docker.volumeName ??
          defaultVolumeName(containerName),
      };
    }
  } catch {
  }

  return {
    containerName: DEFAULT_CONTAINER_NAME,
    volumeName: options.volumeName ?? DEFAULT_VOLUME_NAME,
  };
}

export async function runDockerHelper(
  options: DockerCommandOptions = {},
): Promise<DockerCommandResult> {
  const action = options.action ?? "print";
  const dryRun = options.dryRun ?? action === "print";

  {
    try {
      const projectRoot = await detectProjectRoot(options.cwd ?? process.cwd());
      const config = await loadConfig(projectRoot);
      const share = await loadShareConfig(projectRoot);
      const profile = resolveDeploymentProfile({ config, share });
      if (profile === "hindsight-cloud") {
        throw new NoccioloError(
          "Deployment profile is hindsight-cloud: no local Docker container",
          "Skip `nocciolo docker`. Set NOCCIOLO_HINDSIGHT_URL=https://api.hindsight.vectorize.io and NOCCIOLO_HINDSIGHT_API_KEY, then use seed/mcp against Cloud. See docs/hindsight-cloud.md.",
        );
      }
    } catch (error) {
      if (
        error instanceof NoccioloError &&
        error.message.startsWith("Deployment profile is hindsight-cloud")
      ) {
        throw error;
      }
    }
  }

  const { containerName, volumeName } = await resolveDockerNames({
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.containerName !== undefined
      ? { containerName: options.containerName }
      : {}),
    ...(options.volumeName !== undefined
      ? { volumeName: options.volumeName }
      : {}),
  });
  const llmApiKey = options.llmApiKey ?? resolveLlmApiKey();
  const llmKeyDisplay =
    options.llmApiKey !== undefined
      ? "$HINDSIGHT_API_LLM_API_KEY"
      : resolveLlmApiKeyDisplay();

  if (action === "status") {
    if (!dryRun) {
      await assertDockerAvailable();
    }
    const status = dryRun
      ? {
          exists: false,
          running: false,
          statusLine: `[dry-run] Would query docker ps for "${containerName}"`,
        }
      : await getContainerStatus(containerName);

    return {
      action,
      dryRun,
      display: `docker ps -a --filter name=^/${containerName}$`,
      containerName,
      apiUrl: `http://localhost:${options.apiPort ?? 8888}`,
      uiUrl: `http://localhost:${options.uiPort ?? 9999}`,
      envHints: [],
      statusLine: status.statusLine,
      executed: !dryRun,
    };
  }

  if (action === "down") {
    const plan = buildDockerStopPlan(containerName);
    if (!dryRun) {
      await assertDockerAvailable();
      await runDockerCommand(plan.argv, { allowFailure: true });
    }
    return {
      action,
      dryRun,
      display: plan.display,
      containerName: plan.containerName,
      apiUrl: plan.apiUrl,
      uiUrl: plan.uiUrl,
      envHints: [],
      executed: !dryRun,
    };
  }

  if (action === "up" || action === "print") {
    const plan = buildDockerUpPlan({
      containerName,
      volumeName,
      ...(options.image !== undefined ? { image: options.image } : {}),
      ...(options.apiPort !== undefined ? { apiPort: options.apiPort } : {}),
      ...(options.uiPort !== undefined ? { uiPort: options.uiPort } : {}),
      ...(llmApiKey !== undefined ? { llmApiKey } : {}),
      ...(llmKeyDisplay !== undefined ? { llmKeyDisplay } : {}),
      ...(options.llmProvider !== undefined
        ? { llmProvider: options.llmProvider }
        : {}),
      ...(options.apiKey !== undefined
        ? {
            tenantApiKey: options.apiKey,
            tenantKeyDisplay: "$NOCCIOLO_HINDSIGHT_API_KEY",
          }
        : {}),
      pull: options.pull ?? true,
      detach: options.detach ?? true,
    });

    if (action === "up" && !dryRun) {
      await assertDockerAvailable();
      const existing = await getContainerStatus(containerName);
      if (existing.exists) {
        throw new NoccioloError(
          `Container "${containerName}" already exists (${existing.statusLine})`,
          existing.running
            ? "Hindsight may already be running. Use `nocciolo docker status`, or `nocciolo docker down` then `up` again."
            : "Run `nocciolo docker down` to remove it, then `nocciolo docker up` again.",
        );
      }
      await runDockerCommand(plan.argv);
    }

    return {
      action: action === "print" ? "print" : "up",
      dryRun: dryRun || action === "print",
      display: plan.display,
      containerName: plan.containerName,
      apiUrl: plan.apiUrl,
      uiUrl: plan.uiUrl,
      envHints: plan.envHints,
      executed: action === "up" && !dryRun,
    };
  }

  throw new NoccioloError(
    `Unknown docker action "${String(action)}"`,
    "Use: up, down, status, or print.",
  );
}

export function printDockerResult(result: DockerCommandResult): void {
  const prefix = result.dryRun && result.action !== "status" ? "[dry-run] " : "";

  if (result.action === "status") {
    console.log(result.statusLine ?? "No status.");
    console.log(`API: ${result.apiUrl}`);
    console.log(`UI:  ${result.uiUrl}`);
    return;
  }

  if (result.action === "down") {
    console.log(`${prefix}${result.executed ? "Stopped" : "Would stop"} container: ${result.containerName}`);
    console.log(`${prefix}Command: ${result.display}`);
    return;
  }

  console.log(`${prefix}Local Hindsight container: ${result.containerName}`);
  console.log(`${prefix}Command:`);
  console.log(result.display);
  console.log("");
  console.log(`${prefix}API: ${result.apiUrl}`);
  console.log(`${prefix}UI:  ${result.uiUrl}`);
  for (const hint of result.envHints) {
    console.log(`Note: ${hint}`);
  }
  if (result.executed) {
    console.log("");
    console.log("Next: import your bank template, then `nocciolo seed --dry-run` / `nocciolo seed`.");
    console.log("Wire agents with `nocciolo mcp` (add --write for .cursor/mcp.json).");
  } else if (result.action === "print" || result.dryRun) {
    console.log("");
    console.log("Run without --dry-run: `nocciolo docker up` (requires Docker).");
  }
}

export function parseDockerAction(raw: string | undefined): DockerAction {
  const value = (raw ?? "print").toLowerCase();
  if (
    value === "up" ||
    value === "down" ||
    value === "status" ||
    value === "print" ||
    value === "start" ||
    value === "stop"
  ) {
    if (value === "start") return "up";
    if (value === "stop") return "down";
    return value;
  }
  throw new NoccioloError(
    `Unknown docker action "${raw}"`,
    "Use: up (start), down (stop), status, or print.",
  );
}
