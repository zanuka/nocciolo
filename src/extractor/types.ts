export type KnowledgeKind =
  | "decision"
  | "standard"
  | "architecture"
  | "domain"
  | "overview"
  | "agents"
  | "other";

export interface Provenance {
  sourcePath: string;
  commit?: string;
  kind: string;
}

export interface BankKindStamp {
  id: string;
  tags: string[];
}

export interface ObservationLink {
  relation: "supersedes" | "contradicts";
  observationId: string;
}

export interface CandidateFact {
  id: string;
  title: string;
  content: string;
  knowledgeKind: KnowledgeKind;
  score: number;
  provenance: Provenance;
  bankKind?: BankKindStamp;
  observationLinks?: ObservationLink[];
}

export interface ExtractedSource {
  relativePath: string;
  contentHash: string;
  facts: CandidateFact[];
  heuristicSkips: CandidateFact[];
  skipped: boolean;
  skipReason?: string;
}
