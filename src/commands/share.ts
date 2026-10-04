import {
  loadConfig,
  loadShareConfig,
  saveConfig,
  saveShareConfig,
} from "../config/load.js";
import { resolveProjectConnection } from "../config/connection.js";
import { sharePath } from "../config/paths.js";
import {
  createShareConfig,
  parseDeploymentProfile,
  profileSecurityNotes,
  type DeploymentProfile,
  type McpAuthMode,
  MCP_AUTH_MODES,
} from "../config/profiles.js";
import { detectProjectRoot } from "../project/detect-root.js";
import { NoccioloError } from "../utils/errors.js";

export interface ShareOptions {
  cwd?: string;
  dryRun?: boolean;
  validate?: boolean;
  profile?: string;
  baseUrl?: string;
  mcpAuth?: string;
}

export interface ShareResult {
  projectRoot: string;
  sharePath: string;
  dryRun: boolean;
  validateOnly: boolean;
  wrote: boolean;
  profile: DeploymentProfile;
  baseUrl: string;
  mcpUrl: string;
  serverName: string;
  mcpAuth: McpAuthMode;
  securityNotes: string[];
  share: ReturnType<typeof createShareConfig> | null;
}

function parseMcpAuth(value: string | undefined): McpAuthMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!(MCP_AUTH_MODES as readonly string[]).includes(normalized)) {
    throw new NoccioloError(
      `Unknown mcp auth mode "${value}"`,
      `Use one of: ${MCP_AUTH_MODES.join(", ")}.`,
    );
  }
  return normalized as McpAuthMode;
}

export async function runShare(options: ShareOptions = {}): Promise<ShareResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const validateOnly = options.validate ?? false;
  const projectRoot = await detectProjectRoot(cwd);
  const config = await loadConfig(projectRoot);
  const existingShare = await loadShareConfig(projectRoot);
  const path = sharePath(projectRoot);

  let share = existingShare;
  let wrote = false;

  if (options.profile !== undefined || options.baseUrl !== undefined || options.mcpAuth !== undefined) {
    if (validateOnly) {
      throw new NoccioloError(
        "--validate cannot be combined with generate flags",
        "Run `nocciolo share --validate` alone, or omit --validate to write share.json.",
      );
    }
    const profile = parseDeploymentProfile(
      options.profile ??
        existingShare?.profile ??
        config.deploymentProfile ??
        "local",
    );
    const mcpAuth = parseMcpAuth(options.mcpAuth);
    share = createShareConfig({
      profile,
      ...(options.baseUrl !== undefined
        ? { baseUrl: options.baseUrl }
        : existingShare?.baseUrl !== undefined
          ? { baseUrl: existingShare.baseUrl }
          : {}),
      ...(mcpAuth !== undefined
        ? { mcpAuth }
        : existingShare?.mcpAuth !== undefined
          ? { mcpAuth: existingShare.mcpAuth }
          : {}),
    });
    await saveShareConfig(projectRoot, share, dryRun);
    const nextConfig = {
      ...config,
      deploymentProfile: profile,
      ...(profile === "hindsight-cloud"
        ? { hindsightBaseUrl: "https://api.hindsight.vectorize.io" }
        : options.baseUrl !== undefined
          ? { hindsightBaseUrl: options.baseUrl.replace(/\/+$/, "") }
          : {}),
    };
    await saveConfig(projectRoot, nextConfig, dryRun);
    wrote = !dryRun;
  } else if (validateOnly || share) {
    if (!share) {
      share = createShareConfig({
        profile: config.deploymentProfile ?? "local",
        ...(config.hindsightBaseUrl !== undefined
          ? { baseUrl: config.hindsightBaseUrl }
          : {}),
      });
    }
  } else {
    share = createShareConfig({
      profile: config.deploymentProfile ?? "local",
    });
  }

  if (!share) {
    throw new NoccioloError(
      "No share profile resolved",
      "Pass --profile local|lan|vpn|public|hindsight-cloud.",
    );
  }

  const connection = resolveProjectConnection({
    config: {
      ...config,
      deploymentProfile: share.profile,
      ...(share.baseUrl !== undefined
        ? { hindsightBaseUrl: share.baseUrl }
        : {}),
    },
    share,
  });

  return {
    projectRoot,
    sharePath: path,
    dryRun,
    validateOnly,
    wrote,
    profile: connection.profile,
    baseUrl: connection.baseUrl,
    mcpUrl: connection.mcpUrl,
    serverName: connection.serverName,
    mcpAuth: connection.mcpAuth,
    securityNotes: profileSecurityNotes(connection.profile),
    share,
  };
}

export function printShareResult(result: ShareResult): void {
  const prefix = result.dryRun ? "[dry-run] " : "";
  if (result.validateOnly) {
    console.log(`${prefix}Share profile valid: ${result.profile}`);
  } else if (result.wrote || result.dryRun) {
    console.log(
      `${prefix}${result.dryRun ? "Would write" : "Wrote"} ${result.sharePath}`,
    );
    console.log(
      `${prefix}${result.dryRun ? "Would update" : "Updated"} deploymentProfile in config.json`,
    );
  } else {
    console.log(`${prefix}Active deployment profile: ${result.profile}`);
  }

  console.log(`${prefix}Base URL:    ${result.baseUrl}`);
  console.log(`${prefix}MCP URL:     ${result.mcpUrl}`);
  console.log(`${prefix}Server name: ${result.serverName}`);
  console.log(`${prefix}MCP auth:    ${result.mcpAuth}`);
  console.log("");
  console.log("Security defaults / trade-offs:");
  for (const note of result.securityNotes) {
    console.log(`- ${note}`);
  }
  if (result.profile === "hindsight-cloud") {
    console.log("");
    console.log(
      "Cloud next steps: https://ui.hindsight.vectorize.io (org/bank/key) and https://learn.hindsight.vectorize.io/",
    );
    console.log("Skip `nocciolo docker` under this profile.");
  }
  console.log("");
  console.log(
    "Emit agent wiring with `nocciolo mcp --write --include-auth` (profile-aware URLs/server names).",
  );
}
