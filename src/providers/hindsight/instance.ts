import { NoccioloError } from "../../utils/errors.js";

export interface HindsightVersionInfo {
  api_version?: string;
  version?: string;
  [key: string]: unknown;
}

export interface HindsightHealthInfo {
  status?: string;
  database?: unknown;
  [key: string]: unknown;
}

export interface HindsightBankSummary {
  bank_id?: string;
  bankId?: string;
  name?: string;
  fact_count?: number;
  factCount?: number;
  [key: string]: unknown;
}

export interface HindsightInstanceClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class HindsightInstanceClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HindsightInstanceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    if (options.apiKey !== undefined) {
      this.apiKey = options.apiKey;
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getVersion(): Promise<HindsightVersionInfo> {
    return this.getJson<HindsightVersionInfo>("/version");
  }

  async getHealth(): Promise<HindsightHealthInfo> {
    return this.getJson<HindsightHealthInfo>("/health");
  }

  async listBanks(): Promise<HindsightBankSummary[]> {
    const data = await this.getJson<unknown>("/v1/default/banks");
    if (Array.isArray(data)) {
      return data as HindsightBankSummary[];
    }
    if (data && typeof data === "object") {
      const row = data as Record<string, unknown>;
      if (Array.isArray(row.banks)) {
        return row.banks as HindsightBankSummary[];
      }
      if (Array.isArray(row.items)) {
        return row.items as HindsightBankSummary[];
      }
    }
    return [];
  }

  async getBankStats(bankId: string): Promise<Record<string, unknown>> {
    return this.getJson<Record<string, unknown>>(
      `/v1/default/banks/${encodeURIComponent(bankId)}/stats`,
    );
  }

  async exportBank(bankId: string): Promise<unknown> {
    return this.getJson<unknown>(
      `/v1/default/banks/${encodeURIComponent(bankId)}/export`,
    );
  }

  async tryDocumentTransfer(
    bankId: string,
  ): Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; status: number }> {
    const url = `${this.baseUrl}/v1/default/banks/${encodeURIComponent(bankId)}/document-transfer`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: this.headers({ accept: "*/*" }),
      });
    } catch (error) {
      throw this.reachError(error);
    }
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    const contentType =
      response.headers.get("content-type") ?? "application/octet-stream";
    return { ok: true, bytes: buffer, contentType };
  }

  resolveApiVersion(info: HindsightVersionInfo): string | undefined {
    if (typeof info.api_version === "string" && info.api_version.length > 0) {
      return info.api_version;
    }
    if (typeof info.version === "string" && info.version.length > 0) {
      return info.version;
    }
    return undefined;
  }

  isHealthy(info: HindsightHealthInfo): boolean {
    const status = String(info.status ?? "").toLowerCase();
    if (status.includes("unhealthy") || status.includes("error")) {
      return false;
    }
    if (status.includes("ok") || status.includes("healthy") || status === "up") {
      return true;
    }
    if (info.database !== undefined) {
      const db = info.database;
      if (typeof db === "string") {
        return /ok|connected|up|healthy/i.test(db);
      }
      if (db && typeof db === "object") {
        const row = db as Record<string, unknown>;
        const dbStatus = String(row.status ?? row.state ?? "");
        return /ok|connected|up|healthy/i.test(dbStatus);
      }
    }
    return Object.keys(info).length > 0;
  }

  private async getJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: this.headers(),
      });
    } catch (error) {
      throw this.reachError(error);
    }

    if (!response.ok) {
      const body = await safeReadText(response);
      const authHint =
        response.status === 401 || response.status === 403
          ? " Set NOCCIOLO_HINDSIGHT_API_KEY or HINDSIGHT_API_KEY, or pass --api-key."
          : "";
      throw new NoccioloError(
        `Hindsight request failed (${response.status} ${response.statusText}) for ${path}`,
        body
          ? `Response: ${body.slice(0, 500)}.${authHint}`
          : `Check the server is healthy.${authHint}`,
        response.status,
      );
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  private headers(options: { accept?: string } = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: options.accept ?? "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private reachError(error: unknown): NoccioloError {
    return new NoccioloError(
      `Failed to reach Hindsight at ${this.baseUrl}`,
      `Check that the container is running and --hindsight-url / config / env is correct. (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
