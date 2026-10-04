import { loadConfig, loadShareConfig } from "../config/load.js";
import {
  assertApiKeyForConnection,
  resolveProjectConnection,
} from "../config/connection.js";
import { detectProjectRoot } from "../project/detect-root.js";
import {
  HindsightClient,
  resolveHindsightApiKey,
  type DocumentSummary,
} from "../providers/hindsight/client.js";

export interface DocsListOptions {
  cwd?: string;
  hindsightUrl?: string;
  apiKey?: string;
  limit?: number;
  json?: boolean;
}

export interface DocsListResult {
  projectRoot: string;
  bankId: string;
  baseUrl: string;
  documents: DocumentSummary[];
  total: number;
  json: boolean;
}

export async function runDocsList(
  options: DocsListOptions = {},
): Promise<DocsListResult> {
  const cwd = options.cwd ?? process.cwd();
  const projectRoot = await detectProjectRoot(cwd);
  const config = await loadConfig(projectRoot);
  const share = await loadShareConfig(projectRoot);
  const connection = resolveProjectConnection({
    config,
    share,
    ...(options.hindsightUrl !== undefined
      ? { cliUrl: options.hindsightUrl }
      : {}),
  });
  const apiKey = resolveHindsightApiKey({
    ...(options.apiKey !== undefined ? { cliKey: options.apiKey } : {}),
  });
  assertApiKeyForConnection({ connection, ...(apiKey ? { apiKey } : {}) });

  const client = new HindsightClient({
    baseUrl: connection.baseUrl,
    ...(apiKey !== undefined ? { apiKey } : {}),
  });

  const all = await client.listAllDocuments(config.bankId, {
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });
  const documents =
    options.limit !== undefined ? all.slice(0, options.limit) : all;

  return {
    projectRoot,
    bankId: config.bankId,
    baseUrl: connection.baseUrl,
    documents,
    total: all.length,
    json: options.json ?? false,
  };
}

export function printDocsListResult(result: DocsListResult): void {
  if (result.json) {
    console.log(
      JSON.stringify(
        {
          bankId: result.bankId,
          baseUrl: result.baseUrl,
          total: result.total,
          documents: result.documents.map((d) => ({
            id: d.id,
            tags: d.tags ?? [],
            updated_at: d.updated_at,
            memory_unit_count: d.memory_unit_count,
            source:
              typeof d.document_metadata?.source === "string"
                ? d.document_metadata.source
                : undefined,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Bank: ${result.bankId}`);
  console.log(`Hindsight: ${result.baseUrl}`);
  console.log(`Documents: ${result.total}`);
  console.log("");
  if (result.documents.length === 0) {
    console.log("(none)");
    return;
  }
  for (const doc of result.documents) {
    const source =
      typeof doc.document_metadata?.source === "string"
        ? ` source=${doc.document_metadata.source}`
        : "";
    const units =
      typeof doc.memory_unit_count === "number"
        ? ` memories=${doc.memory_unit_count}`
        : "";
    console.log(`${doc.id}${source}${units}`);
  }
  console.log("");
  console.log(
    "Delete with `nocciolo prune --document-id <id> --yes` (or --dry-run first).",
  );
}