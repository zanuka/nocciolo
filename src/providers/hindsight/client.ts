import { NoccioloError } from "../../utils/errors.js";

export interface RetainItem {
  content: string;
  context: string;
  document_id: string;
  timestamp: "unset";
  metadata: Record<string, string>;
  tags: string[];
}

export interface RetainRequest {
  items: RetainItem[];
  async?: boolean;
}

export interface RetainResponse {
  success?: boolean;
  bank_id?: string;
  items_count?: number;
  async?: boolean;
  operation_id?: string;
  operation_ids?: string[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export interface OperationProgress {
  stage?: string;
  at?: string;
  processed?: number | null;
  total?: number | null;
  detail?: Record<string, unknown>;
}

export interface OperationStatus {
  id?: string;
  status?: string;
  error_message?: string | null;
  updated_at?: string | null;
  progress?: OperationProgress | null;
}

export interface DocumentSummary {
  id: string;
  bank_id?: string;
  content_hash?: string | null;
  created_at?: string;
  updated_at?: string;
  text_length?: number;
  memory_unit_count?: number;
  tags?: string[];
  document_metadata?: Record<string, unknown> | null;
  retain_params?: Record<string, unknown> | null;
}

export interface ListDocumentsOptions {
  q?: string;
  tags?: string[];
  tagsMatch?: string;
  limit?: number;
  offset?: number;
}

export interface ListDocumentsResponse {
  items: DocumentSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface DeleteDocumentResponse {
  success: boolean;
  message: string;
  document_id: string;
  memory_units_deleted: number;
}

export interface HindsightClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class HindsightClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HindsightClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    if (options.apiKey !== undefined) {
      this.apiKey = options.apiKey;
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async retain(
    bankId: string,
    request: RetainRequest,
  ): Promise<RetainResponse> {
    const url = `${this.baseUrl}/v1/default/banks/${encodeURIComponent(bankId)}/memories`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          items: request.items,
          async: request.async ?? false,
        }),
      });
    } catch (error) {
      throw new NoccioloError(
        `Failed to reach Hindsight at ${this.baseUrl}`,
        `Check that Hindsight is running and NOCCIOLO_HINDSIGHT_URL / config hindsightBaseUrl is correct. (${error instanceof Error ? error.message : String(error)})`,
      );
    }

    if (!response.ok) {
      const body = await safeReadText(response);
      const authHint =
        response.status === 401 || response.status === 403
          ? " Set NOCCIOLO_HINDSIGHT_API_KEY or HINDSIGHT_API_KEY (same value as HINDSIGHT_API_TENANT_API_KEY in your Hindsight container), or pass --api-key."
          : "";
      throw new NoccioloError(
        `Hindsight retain failed (${response.status} ${response.statusText}) for bank "${bankId}"`,
        body
          ? `Response: ${body.slice(0, 500)}.${authHint}`
          : `Verify the bank id exists and the retain payload is valid.${authHint}`,
        response.status,
      );
    }

    if (response.status === 204) {
      return {
        success: true,
        bank_id: bankId,
        items_count: request.items.length,
      };
    }

    return (await response.json()) as RetainResponse;
  }

  async getOperationStatus(
    bankId: string,
    operationId: string,
  ): Promise<OperationStatus> {
    const url = `${this.baseUrl}/v1/default/banks/${encodeURIComponent(bankId)}/operations/${encodeURIComponent(operationId)}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: this.headers(),
      });
    } catch (error) {
      throw new NoccioloError(
        `Failed to reach Hindsight at ${this.baseUrl}`,
        `Could not poll operation status. (${error instanceof Error ? error.message : String(error)})`,
      );
    }

    if (!response.ok) {
      const body = await safeReadText(response);
      throw new NoccioloError(
        `Hindsight operation status failed (${response.status}) for "${operationId}"`,
        body ? `Response: ${body.slice(0, 500)}` : undefined,
        response.status,
      );
    }

    return (await response.json()) as OperationStatus;
  }

  async listDocuments(
    bankId: string,
    options: ListDocumentsOptions = {},
  ): Promise<ListDocumentsResponse> {
    const params = new URLSearchParams();
    if (options.q !== undefined) {
      params.set("q", options.q);
    }
    if (options.tags !== undefined) {
      for (const tag of options.tags) {
        params.append("tags", tag);
      }
    }
    if (options.tagsMatch !== undefined) {
      params.set("tags_match", options.tagsMatch);
    }
    if (options.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    if (options.offset !== undefined) {
      params.set("offset", String(options.offset));
    }
    const query = params.toString();
    const url = `${this.baseUrl}/v1/default/banks/${encodeURIComponent(bankId)}/documents${query ? `?${query}` : ""}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: this.headers(),
      });
    } catch (error) {
      throw new NoccioloError(
        `Failed to reach Hindsight at ${this.baseUrl}`,
        `Could not list documents. (${error instanceof Error ? error.message : String(error)})`,
      );
    }

    if (!response.ok) {
      const body = await safeReadText(response);
      const authHint =
        response.status === 401 || response.status === 403
          ? " Set NOCCIOLO_HINDSIGHT_API_KEY or HINDSIGHT_API_KEY (same value as HINDSIGHT_API_TENANT_API_KEY in your Hindsight container), or pass --api-key."
          : "";
      throw new NoccioloError(
        `Hindsight list documents failed (${response.status} ${response.statusText}) for bank "${bankId}"`,
        body
          ? `Response: ${body.slice(0, 500)}.${authHint}`
          : `Verify the bank id exists.${authHint}`,
        response.status,
      );
    }

    const raw = (await response.json()) as ListDocumentsResponse;
    return {
      items: Array.isArray(raw.items) ? raw.items : [],
      total: typeof raw.total === "number" ? raw.total : 0,
      limit: typeof raw.limit === "number" ? raw.limit : options.limit ?? 100,
      offset: typeof raw.offset === "number" ? raw.offset : options.offset ?? 0,
    };
  }

  async listAllDocuments(
    bankId: string,
    options: Omit<ListDocumentsOptions, "offset"> = {},
  ): Promise<DocumentSummary[]> {
    const pageSize = options.limit ?? 100;
    const items: DocumentSummary[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;

    while (offset < total) {
      const page = await this.listDocuments(bankId, {
        ...options,
        limit: pageSize,
        offset,
      });
      items.push(...page.items);
      total = page.total;
      if (page.items.length === 0) {
        break;
      }
      offset += page.items.length;
      if (page.items.length < pageSize) {
        break;
      }
    }

    return items;
  }

  async deleteDocument(
    bankId: string,
    documentId: string,
  ): Promise<DeleteDocumentResponse> {
    const url = `${this.baseUrl}/v1/default/banks/${encodeURIComponent(bankId)}/documents/${encodeURIComponent(documentId)}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "DELETE",
        headers: this.headers(),
      });
    } catch (error) {
      throw new NoccioloError(
        `Failed to reach Hindsight at ${this.baseUrl}`,
        `Could not delete document. (${error instanceof Error ? error.message : String(error)})`,
      );
    }

    if (!response.ok) {
      const body = await safeReadText(response);
      const authHint =
        response.status === 401 || response.status === 403
          ? " Set NOCCIOLO_HINDSIGHT_API_KEY or HINDSIGHT_API_KEY (same value as HINDSIGHT_API_TENANT_API_KEY in your Hindsight container), or pass --api-key."
          : "";
      throw new NoccioloError(
        `Hindsight delete document failed (${response.status} ${response.statusText}) for "${documentId}"`,
        body
          ? `Response: ${body.slice(0, 500)}.${authHint}`
          : `Verify the document id exists in bank "${bankId}".${authHint}`,
        response.status,
      );
    }

    if (response.status === 204) {
      return {
        success: true,
        message: `Document '${documentId}' deleted`,
        document_id: documentId,
        memory_units_deleted: 0,
      };
    }

    return (await response.json()) as DeleteDocumentResponse;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }
}

export function resolveHindsightBaseUrl(input: {
  cliUrl?: string;
  configUrl?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = input.env ?? process.env;
  const fromEnv =
    env.NOCCIOLO_HINDSIGHT_URL?.trim() || env.HINDSIGHT_URL?.trim();
  return (
    input.cliUrl?.trim() ||
    input.configUrl?.trim() ||
    fromEnv ||
    "http://localhost:8888"
  );
}

export function resolveHindsightApiKey(input: {
  cliKey?: string;
  configKey?: string;
  env?: NodeJS.ProcessEnv;
}): string | undefined {
  const env = input.env ?? process.env;
  const key =
    input.cliKey?.trim() ||
    input.configKey?.trim() ||
    env.NOCCIOLO_HINDSIGHT_API_KEY?.trim() ||
    env.HINDSIGHT_API_KEY?.trim();
  return key || undefined;
}

export function formatPercent(processed: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.min(100, Math.round((processed / total) * 100))}%`;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
