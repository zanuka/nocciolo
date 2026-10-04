import {
  defaultBaseUrlForProfile,
  HINDSIGHT_CLOUD_OAUTH_MCP_URL,
  LOCAL_HINDSIGHT_URL,
  type DeploymentProfile,
  type McpAuthMode,
  type ShareConfig,
} from "./profiles.js";
import type { NoccioloConfig } from "./schema.js";
import { resolveHindsightBaseUrl } from "../providers/hindsight/client.js";
import {
  buildSingleBankMcpUrl,
  defaultMcpServerName,
} from "../integration/mcp-url.js";
import { NoccioloError } from "../utils/errors.js";

export interface ResolvedConnection {
  profile: DeploymentProfile;
  baseUrl: string;
  mcpUrl: string;
  mcpAuth: McpAuthMode;
  serverName: string;
  requiresApiKey: boolean;
  skipDocker: boolean;
}

export function resolveDeploymentProfile(input: {
  config: NoccioloConfig;
  share?: ShareConfig | null;
}): DeploymentProfile {
  return input.share?.profile ?? input.config.deploymentProfile ?? "local";
}

export function resolveProjectConnection(input: {
  config: NoccioloConfig;
  share?: ShareConfig | null;
  cliUrl?: string;
  serverName?: string;
  env?: NodeJS.ProcessEnv;
}): ResolvedConnection {
  const profile = resolveDeploymentProfile(input);
  const share = input.share ?? null;
  const profileDefaultUrl = defaultBaseUrlForProfile(profile);
  const explicitShareUrl =
    share?.baseUrl ??
    (profile === "hindsight-cloud" ? profileDefaultUrl : undefined);

  const hasExplicitSource = Boolean(
    input.cliUrl?.trim() ||
      input.config.hindsightBaseUrl?.trim() ||
      input.env?.NOCCIOLO_HINDSIGHT_URL?.trim() ||
      input.env?.HINDSIGHT_URL?.trim() ||
      share?.baseUrl?.trim() ||
      profileDefaultUrl,
  );

  if (
    (profile === "lan" || profile === "vpn" || profile === "public") &&
    !hasExplicitSource
  ) {
    throw new NoccioloError(
      `Deployment profile "${profile}" needs a base URL`,
      `Set baseUrl in \`.nocciolo/share.json\`, pass --hindsight-url, or run \`nocciolo share --profile ${profile} --base-url <url>\`.`,
    );
  }

  const baseUrl = resolveHindsightBaseUrl({
    ...(input.cliUrl !== undefined ? { cliUrl: input.cliUrl } : {}),
    ...(input.config.hindsightBaseUrl !== undefined
      ? { configUrl: input.config.hindsightBaseUrl }
      : {}),
    ...(explicitShareUrl !== undefined ? { shareUrl: explicitShareUrl } : {}),
    ...(profileDefaultUrl !== undefined
      ? { profileDefaultUrl }
      : {}),
    ...(input.env !== undefined ? { env: input.env } : {}),
  });

  const mcpAuth: McpAuthMode =
    share?.mcpAuth ??
    (profile === "hindsight-cloud" ? "api-key" : "api-key");

  const mcpUrl =
    profile === "hindsight-cloud" && mcpAuth === "oauth"
      ? HINDSIGHT_CLOUD_OAUTH_MCP_URL
      : buildSingleBankMcpUrl(baseUrl, input.config.bankId);

  return {
    profile,
    baseUrl,
    mcpUrl,
    mcpAuth,
    serverName: input.serverName ?? defaultMcpServerName(input.config.bankId),
    requiresApiKey: profile === "hindsight-cloud",
    skipDocker: profile === "hindsight-cloud",
  };
}

export function assertApiKeyForConnection(input: {
  connection: ResolvedConnection;
  apiKey?: string;
}): void {
  if (!input.connection.requiresApiKey) {
    return;
  }
  if (input.apiKey) {
    return;
  }
  throw new NoccioloError(
    "Hindsight Cloud requires an API key",
    "Create a key at https://ui.hindsight.vectorize.io → Connect, then set NOCCIOLO_HINDSIGHT_API_KEY or pass --api-key.",
  );
}

export function isLocalDefaultUrl(url: string): boolean {
  const normalized = url.replace(/\/+$/, "");
  return (
    normalized === LOCAL_HINDSIGHT_URL ||
    normalized === "http://127.0.0.1:8888"
  );
}