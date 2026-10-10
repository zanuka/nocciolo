import { setTimeout as delay } from "node:timers/promises";
import type { HindsightClient } from "./client.js";
import { formatOperationProgressLine } from "./progress.js";

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
