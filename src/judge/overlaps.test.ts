import { describe, expect, it } from "vitest";
import { JEV_OVERLAP_MAX } from "./state.js";
import {
  observationRecallQuery,
  recalledToOverlaps,
} from "./overlaps.js";

describe("observation overlaps", () => {
  it("builds a short recall query from the section", () => {
    const query = observationRecallQuery({
      title: "ADR 0008: Use Postgres",
      content: "We use Postgres.",
    });
    expect(query).toContain("ADR 0008: Use Postgres");
    expect(query).toContain("We use Postgres.");
  });

  it("keeps the top observation ids and drops empty or duplicate rows", () => {
    const overlaps = recalledToOverlaps([
      { id: "obs-mysql", text: "We use MySQL.", documentId: "doc-1" },
      { id: "obs-mysql", text: "duplicate" },
      { id: " ", text: "missing id" },
      { id: "obs-empty", text: "  " },
      ...Array.from({ length: JEV_OVERLAP_MAX + 2 }, (_, index) => ({
        id: `obs-${index}`,
        text: `claim ${index}`,
      })),
    ]);
    expect(overlaps).toHaveLength(JEV_OVERLAP_MAX);
    expect(overlaps[0]).toEqual({
      id: "obs-mysql",
      summary: "We use MySQL.",
      documentId: "doc-1",
    });
  });
});
