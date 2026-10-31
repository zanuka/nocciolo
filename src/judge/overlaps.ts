import { JEV_OVERLAP_MAX, type JevOverlap } from "./state.js";

export const OBSERVATION_QUERY_MAX_CHARS = 1_500;

export interface RecalledObservationText {
  id: string;
  text: string;
  documentId?: string;
}

export function observationRecallQuery(input: {
  title: string;
  content: string;
}): string {
  return `${input.title}\n${input.content}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, OBSERVATION_QUERY_MAX_CHARS);
}

export function recalledToOverlaps(
  results: readonly RecalledObservationText[],
): JevOverlap[] {
  const seen = new Set<string>();
  const overlaps: JevOverlap[] = [];
  for (const result of results) {
    const id = result.id.trim();
    const summary = result.text.trim();
    if (id === "" || summary === "" || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const overlap: JevOverlap = { id, summary };
    if (result.documentId !== undefined && result.documentId.trim() !== "") {
      overlap.documentId = result.documentId.trim();
    }
    overlaps.push(overlap);
    if (overlaps.length >= JEV_OVERLAP_MAX) {
      break;
    }
  }
  return overlaps;
}
