import { setTimeout as delay } from "node:timers/promises";
import type { HindsightClient } from "./client.js";
import { formatOperationProgressLine } from "./progress.js";
import type { HindsightBankTemplate } from "./types.js";

export async function pollOperationUntilDone(
  client: HindsightClient,
  bankId: string,
  operationId: string,
  options: { log?: (line: string) => void; intervalMs?: number } = {},
): Promise<void> {
  const log = options.log ?? ((line: string) => console.log(`  ${line}`));
  const intervalMs = options.intervalMs ?? 2000;
  let lastLine = "";
  for (;;) {
    const status = await client.getOperationStatus(bankId, operationId);
    const line = formatOperationProgressLine(operationId, status);
    if (line !== lastLine) {
      log(line);
      lastLine = line;
    }

    const state = status.status ?? "";
    if (state === "completed") {
      log(`Operation ${operationId} completed.`);
      return;
    }
    if (state === "failed" || state === "cancelled") {
      throw new Error(
        `Hindsight operation ${operationId} ${state}${status.error_message ? `: ${status.error_message}` : ""}`,
      );
    }

    await delay(intervalMs);
  }
}

export function collectOperationIds(response: {
  operation_id?: string;
  operation_ids?: string[];
}): string[] {
  if (response.operation_ids && response.operation_ids.length > 0) {
    return response.operation_ids;
  }
  if (response.operation_id) {
    return [response.operation_id];
  }
  return [];
}

export interface RefreshDeclaredModelsResult {
  dryRun: boolean;
  modelIds: string[];
  refreshed: string[];
  skipped: string[];
  previews: Array<{ id: string; summary: string }>;
}

export async function refreshDeclaredMentalModels(input: {
  client: HindsightClient;
  bankId: string;
  template: HindsightBankTemplate;
  dryRun?: boolean;
  modelIds?: string[];
}): Promise<RefreshDeclaredModelsResult> {
  const dryRun = input.dryRun ?? false;
  const declared = input.template.mental_models.map((m) => m.id);
  const wanted =
    input.modelIds && input.modelIds.length > 0
      ? declared.filter((id) => input.modelIds!.includes(id))
      : declared;

  const refreshed: string[] = [];
  const skipped: string[] = [];
  const previews: Array<{ id: string; summary: string }> = [];

  for (const id of wanted) {
    if (dryRun) {
      try {
        const preview = await input.client.dryRunRefreshMentalModel(
          input.bankId,
          id,
        );
        const summary = [
          preview.effective_mode ? `mode=${preview.effective_mode}` : undefined,
          preview.would_persist !== undefined
            ? `would_persist=${String(preview.would_persist)}`
            : undefined,
          preview.outcome ? `outcome=${preview.outcome}` : undefined,
        ]
          .filter((part): part is string => part !== undefined)
          .join(", ");
        previews.push({
          id,
          summary: summary.length > 0 ? summary : "dry-run-refresh ok",
        });
        refreshed.push(id);
      } catch {
        previews.push({
          id,
          summary:
            "would refresh (dry-run-refresh unavailable; live refresh not run)",
        });
        refreshed.push(id);
      }
      continue;
    }

    const response = await input.client.refreshMentalModel(input.bankId, id);
    const operationIds = collectOperationIds(response);
    if (operationIds.length === 0) {
      refreshed.push(id);
      continue;
    }
    for (const operationId of operationIds) {
      await pollOperationUntilDone(input.client, input.bankId, operationId);
    }
    refreshed.push(id);
  }

  for (const id of declared) {
    if (!wanted.includes(id)) {
      skipped.push(id);
    }
  }

  return {
    dryRun,
    modelIds: wanted,
    refreshed,
    skipped,
    previews,
  };
}
