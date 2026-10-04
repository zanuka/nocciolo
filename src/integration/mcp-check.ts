import { NoccioloError } from "../utils/errors.js";

export interface McpCheckResult {
  ok: boolean;
  status: number;
  detail: string;
}

export async function checkMcpConnectivity(input: {
  mcpUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<McpCheckResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (input.apiKey) {
    headers.Authorization = `Bearer ${input.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(input.mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "nocciolo", version: "0.0.0" },
        },
      }),
    });
  } catch (error) {
    throw new NoccioloError(
      `Failed to reach MCP at ${input.mcpUrl}`,
      `Check that Hindsight is running and the deployment profile base URL is correct. (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      status: response.status,
      detail:
        "Authentication failed. Set NOCCIOLO_HINDSIGHT_API_KEY / HINDSIGHT_API_KEY in the Cursor process environment (not only a terminal), or pass --api-key for this check.",
    };
  }

  if (!response.ok) {
    const body = await safeReadText(response);
    return {
      ok: false,
      status: response.status,
      detail: body
        ? `MCP probe failed: ${body.slice(0, 200)}`
        : `MCP probe failed with HTTP ${response.status}.`,
    };
  }

  return {
    ok: true,
    status: response.status,
    detail: "MCP endpoint accepted an initialize probe.",
  };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
