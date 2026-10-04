import { z } from "zod";
import { NoccioloError } from "../utils/errors.js";

export const DEPLOYMENT_PROFILES = [
  "local",
  "lan",
  "vpn",
  "public",
  "hindsight-cloud",
] as const;

export type DeploymentProfile = (typeof DEPLOYMENT_PROFILES)[number];

export const MCP_AUTH_MODES = ["api-key", "oauth"] as const;
export type McpAuthMode = (typeof MCP_AUTH_MODES)[number];

export const HINDSIGHT_CLOUD_API_URL = "https://api.hindsight.vectorize.io";
export const HINDSIGHT_CLOUD_OAUTH_MCP_URL =
  "https://mcp.hindsight.vectorize.io";
export const LOCAL_HINDSIGHT_URL = "http://localhost:8888";

export const ShareConfigSchema = z.object({
  version: z.literal(1),
  profile: z.enum(DEPLOYMENT_PROFILES),
  baseUrl: z.string().url().optional(),
  mcpAuth: z.enum(MCP_AUTH_MODES).optional(),
});

export type ShareConfig = z.infer<typeof ShareConfigSchema>;

export function isDeploymentProfile(value: string): value is DeploymentProfile {
  return (DEPLOYMENT_PROFILES as readonly string[]).includes(value);
}

export function parseDeploymentProfile(value: string): DeploymentProfile {
  const normalized = value.trim().toLowerCase();
  if (!isDeploymentProfile(normalized)) {
    throw new NoccioloError(
      `Unknown deployment profile "${value}"`,
      `Use one of: ${DEPLOYMENT_PROFILES.join(", ")}.`,
    );
  }
  return normalized;
}

export function defaultBaseUrlForProfile(
  profile: DeploymentProfile,
): string | undefined {
  if (profile === "local") {
    return LOCAL_HINDSIGHT_URL;
  }
  if (profile === "hindsight-cloud") {
    return HINDSIGHT_CLOUD_API_URL;
  }
  return undefined;
}

export function createShareConfig(input: {
  profile: DeploymentProfile;
  baseUrl?: string;
  mcpAuth?: McpAuthMode;
}): ShareConfig {
  const share: ShareConfig = {
    version: 1,
    profile: input.profile,
  };
  if (input.baseUrl !== undefined) {
    share.baseUrl = input.baseUrl.replace(/\/+$/, "");
  }
  if (input.mcpAuth !== undefined) {
    share.mcpAuth = input.mcpAuth;
  } else if (input.profile === "hindsight-cloud") {
    share.mcpAuth = "api-key";
  }
  return share;
}

export function validateShareConfig(share: ShareConfig): void {
  const parsed = ShareConfigSchema.safeParse(share);
  if (!parsed.success) {
    throw new NoccioloError(
      `Invalid share config: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      "Fix `.nocciolo/share.json` or re-run `nocciolo share --profile <profile>`.",
    );
  }

  if (
    (share.profile === "lan" ||
      share.profile === "vpn" ||
      share.profile === "public") &&
    !share.baseUrl
  ) {
    throw new NoccioloError(
      `Profile "${share.profile}" requires a non-secret base URL`,
      "Pass --base-url (e.g. http://192.168.1.10:8888) or set baseUrl in `.nocciolo/share.json`.",
    );
  }

  if (share.profile === "local" && share.baseUrl) {
    const host = new URL(share.baseUrl).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      throw new NoccioloError(
        `Profile "local" should use localhost, got ${share.baseUrl}`,
        "Use --profile lan (or vpn/public) for a shared host, or omit --base-url for local.",
      );
    }
  }

  if (share.profile === "hindsight-cloud") {
    if (share.baseUrl && share.baseUrl !== HINDSIGHT_CLOUD_API_URL) {
      throw new NoccioloError(
        `Profile "hindsight-cloud" expects ${HINDSIGHT_CLOUD_API_URL}`,
        "Omit --base-url for Cloud, or set profile to lan/vpn/public for a custom host.",
      );
    }
    if (share.mcpAuth === "oauth") {
      return;
    }
  } else if (share.mcpAuth === "oauth") {
    throw new NoccioloError(
      `mcpAuth "oauth" is only valid for hindsight-cloud`,
      "Use --mcp-auth api-key, or switch --profile hindsight-cloud.",
    );
  }
}

export function profileSecurityNotes(profile: DeploymentProfile): string[] {
  switch (profile) {
    case "local":
      return [
        "Bind Hindsight to localhost only; do not publish API/UI ports to untrusted networks.",
        "Tenant API keys are optional locally but recommended once more than one user shares the machine.",
        "Never commit API keys; use NOCCIOLO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY in the process env (Cursor inherits login-shell env).",
      ];
    case "lan":
      return [
        "Expose Hindsight only on a trusted LAN; prefer TLS termination or an SSH/VPN tunnel when the LAN is mixed-trust.",
        "Require a tenant API key; rotate it when people leave the network.",
        "Firewall the Control Plane UI if teammates only need MCP/API access.",
      ];
    case "vpn":
      return [
        "Reachability should require VPN membership; do not publish the bank on the public internet.",
        "Require API keys; treat VPN membership as network auth, not application auth.",
        "Document the private hostname in share.json baseUrl (no secrets).",
      ];
    case "public":
      return [
        "Intentional public exposure: use TLS, strong API keys, and rate limits on the host.",
        "Only use this profile when the knowledge is meant to be open; still never seed secrets.",
        "Prefer short-lived bot keys and separate human access where possible.",
      ];
    case "hindsight-cloud":
      return [
        "Managed host: https://api.hindsight.vectorize.io (skip local Docker).",
        "API key required for seed/apply; create keys in the Cloud console and keep them out of git.",
        "Default MCP emission is bank-scoped API URL + env key; OAuth MCP is optional for interactive IDEs.",
        "Cloud retain/reflect consume credits; review org billing and data residency before adopting.",
      ];
  }
}
