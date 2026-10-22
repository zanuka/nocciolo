import { isSensitiveRelativePath } from "../scanner/sensitive.js";
import { NoccioloError } from "../utils/errors.js";

export const JEV_CHARS_PER_TOKEN = 4;
export const JEV_STATE_QUESTION_TOKEN_BUDGET = 32_000;
export const JEV_QUESTION_TOKEN_RESERVE = 8_000;
export const JEV_STATE_MAX_TOKENS =
  JEV_STATE_QUESTION_TOKEN_BUDGET - JEV_QUESTION_TOKEN_RESERVE;
export const JEV_STATE_MAX_CHARS = JEV_STATE_MAX_TOKENS * JEV_CHARS_PER_TOKEN;

export const JEV_SECTION_MAX_CHARS = 6_000;
export const JEV_MISSION_MAX_CHARS = 1_200;
export const JEV_HEADING_MAX_CHARS = 200;
export const JEV_PATH_MAX_CHARS = 500;
export const JEV_OVERLAP_MAX = 5;
export const JEV_OVERLAP_SUMMARY_MAX_CHARS = 400;
export const JEV_DOCUMENT_ID_MAX_CHARS = 200;

const TRUNCATION_MARKER = "\n[truncated]";
const SECRET_WALK_MAX_DEPTH = 8;

const SECRET_PATTERNS: ReadonlyArray<{ source: string; flags: string }> = [
  { source: "-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----", flags: "" },
  { source: "\\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}", flags: "" },
  { source: "\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}", flags: "" },
  { source: "\\bAKIA[0-9A-Z]{16}\\b", flags: "" },
  { source: "\\bgh[pousr]_[A-Za-z0-9]{20,}", flags: "" },
  { source: "\\bgithub_pat_[A-Za-z0-9_]{20,}", flags: "" },
  { source: "\\bxox[baprs]-[A-Za-z0-9-]{10,}", flags: "" },
  { source: "\\bnpm_[A-Za-z0-9]{20,}", flags: "" },
  {
    source: "\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}",
    flags: "",
  },
  {
    source:
      "\\b(?:postgres|postgresql|mysql|mongodb(?:\\+srv)?|redis|amqp|amqps):\\/\\/[^:\\s'\"]+:[^@\\s'\"]+@",
    flags: "i",
  },
  {
    source:
      "\\b(?:api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|password|passwd)\\b\\s*[=:]\\s*['\"]?[A-Za-z0-9_./+=-]{12,}",
    flags: "i",
  },
];

export interface JevOverlap {
  summary: string;
  documentId?: string;
}

export interface JevStateCandidate {
  path: string;
  heading?: string;
  sectionText: string;
  mission?: string;
  overlaps?: readonly JevOverlap[];
}

export interface JevState {
  path: string;
  heading?: string;
  section: string;
  mission?: string;
  overlaps?: JevOverlap[];
}

export type JevStateSkipReason = "denylist" | "inline-secret" | "empty";

export interface JevStateSkip {
  ok: false;
  reason: JevStateSkipReason;
  path: string;
  message: string;
}

export interface JevStateReady {
  ok: true;
  state: JevState;
}

export type JevStateBuild = JevStateReady | JevStateSkip;

export type JevLogLevel = "info" | "debug";

export interface JevDispatchLog {
  level: JevLogLevel;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function secretPatterns(extraFlags: string): RegExp[] {
  return SECRET_PATTERNS.map(
    (pattern) => new RegExp(pattern.source, `${pattern.flags}${extraFlags}`),
  );
}

export function containsInlineSecret(value: unknown, depth = 0): boolean {
  if (depth > SECRET_WALK_MAX_DEPTH) {
    return true;
  }
  if (typeof value === "string") {
    return secretPatterns("").some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsInlineSecret(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.values(value).some((item) =>
      containsInlineSecret(item, depth + 1),
    );
  }
  return false;
}

function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of secretPatterns("g")) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

function displayPath(path: string): string {
  if (path === "") {
    return "(empty path)";
  }
  if (containsInlineSecret(path)) {
    return redactSecrets(path);
  }
  return path;
}

function normalizePath(path: string): string {
  return path.trim().split(/[/\\]/).join("/");
}

function capText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  if (maxChars <= TRUNCATION_MARKER.length) {
    return trimmed.slice(0, maxChars);
  }
  return `${trimmed.slice(0, maxChars - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

function skip(reason: JevStateSkipReason, rawPath: string): JevStateSkip {
  const path = displayPath(rawPath);
  const message =
    reason === "denylist"
      ? `Skipped judging ${path}: path is on the secrets denylist.`
      : reason === "inline-secret"
        ? `Skipped judging ${path}: text matched a secret pattern.`
        : rawPath === ""
          ? "Skipped judging: path is empty."
          : `Skipped judging ${path}: section text is empty.`;
  return { ok: false, reason, path, message };
}

function candidateHasSecret(input: JevStateCandidate, path: string): boolean {
  const texts = [path, input.sectionText];
  if (input.heading !== undefined) {
    texts.push(input.heading);
  }
  if (input.mission !== undefined) {
    texts.push(input.mission);
  }
  for (const overlap of input.overlaps ?? []) {
    texts.push(overlap.summary);
    if (overlap.documentId !== undefined) {
      texts.push(overlap.documentId);
    }
  }
  return texts.some((text) => containsInlineSecret(text));
}

export function fitJevState(
  state: JevState,
  maxChars: number = JEV_STATE_MAX_CHARS,
): JevState {
  if (JSON.stringify(state).length <= maxChars) {
    return state;
  }

  let path = state.path;
  let section = state.section;
  let current: JevState = { path, section };
  let guard = 0;
  while (JSON.stringify(current).length > maxChars && guard < 4) {
    const overflow = JSON.stringify(current).length - maxChars;
    if (section.length > 0) {
      section = section.slice(0, Math.max(0, section.length - overflow));
    } else if (path.length > 0) {
      path = path.slice(0, Math.max(0, path.length - overflow));
    } else {
      break;
    }
    current = { path, section };
    guard += 1;
  }
  return current;
}

export function buildJevState(input: JevStateCandidate): JevStateBuild {
  const path = normalizePath(input.path);
  if (path === "") {
    return skip("empty", "");
  }
  if (isSensitiveRelativePath(path)) {
    return skip("denylist", path);
  }
  if (candidateHasSecret(input, path)) {
    return skip("inline-secret", path);
  }
  if (input.sectionText.trim() === "") {
    return skip("empty", path);
  }

  const state: JevState = {
    path: capText(path, JEV_PATH_MAX_CHARS),
    section: capText(input.sectionText, JEV_SECTION_MAX_CHARS),
  };
  if (input.heading !== undefined && input.heading.trim() !== "") {
    state.heading = capText(input.heading, JEV_HEADING_MAX_CHARS);
  }
  if (input.mission !== undefined && input.mission.trim() !== "") {
    state.mission = capText(input.mission, JEV_MISSION_MAX_CHARS);
  }

  const overlaps = (input.overlaps ?? [])
    .filter((item) => item.summary.trim() !== "")
    .slice(0, JEV_OVERLAP_MAX)
    .map((item) => {
      const overlap: JevOverlap = {
        summary: capText(item.summary, JEV_OVERLAP_SUMMARY_MAX_CHARS),
      };
      if (item.documentId !== undefined && item.documentId.trim() !== "") {
        overlap.documentId = capText(item.documentId, JEV_DOCUMENT_ID_MAX_CHARS);
      }
      return overlap;
    });
  if (overlaps.length > 0) {
    state.overlaps = overlaps;
  }

  return { ok: true, state: fitJevState(state) };
}

function readPath(state: unknown): string | undefined {
  if (isRecord(state) && typeof state.path === "string") {
    return state.path;
  }
  return undefined;
}

export function assertJevStateSendable(state: unknown): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(state) ?? "";
  } catch {
    throw new NoccioloError(
      "Refusing to send Jev state: value is not JSON.",
      "Pass the object returned by buildJevState.",
    );
  }

  const path = readPath(state);
  if (path !== undefined && isSensitiveRelativePath(path)) {
    const label = displayPath(path);
    throw new NoccioloError(
      `Refusing to send Jev state for ${label}: path is on the secrets denylist.`,
      "Judge only seedable paths, or omit --judge jev.",
    );
  }
  if (containsInlineSecret(state)) {
    const label =
      path !== undefined && !containsInlineSecret(path) ? ` for ${path}` : "";
    throw new NoccioloError(
      `Refusing to send Jev state${label}: text matched a secret pattern.`,
      "Remove the secret from the source, or omit --judge jev.",
    );
  }
  if (encoded.length > JEV_STATE_MAX_CHARS) {
    throw new NoccioloError(
      `Refusing to send Jev state: ${encoded.length} chars exceeds the ${JEV_STATE_MAX_TOKENS} token budget.`,
      "Send a section excerpt instead of the full file or bank.",
    );
  }
}

function fieldLengths(state: unknown): string {
  if (typeof state === "string") {
    return `state:${state.length}`;
  }
  if (!isRecord(state)) {
    return "state:0";
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === "string") {
      parts.push(`${key}:${value.length}`);
    } else if (Array.isArray(value)) {
      parts.push(`${key}:${value.length}`);
    } else if (value !== undefined && value !== null) {
      parts.push(`${key}:1`);
    }
  }
  return parts.join(",");
}

export function jevDispatchLogs(input: {
  questionIds: readonly string[];
  state: unknown;
}): JevDispatchLog[] {
  const questions = input.questionIds
    .map((id) => (containsInlineSecret(id) ? "[redacted]" : id))
    .join(",");
  const path = readPath(input.state);
  const safePath =
    path !== undefined && !containsInlineSecret(path) ? path : undefined;
  const info =
    safePath !== undefined
      ? `jev judge path=${safePath} questions=${questions}`
      : `jev judge questions=${questions}`;
  const lengths = fieldLengths(input.state);
  const fields = lengths
    .split(",")
    .filter((part) => part !== "")
    .map((part) => part.slice(0, part.lastIndexOf(":")))
    .join(",");
  return [
    { level: "info", message: info },
    {
      level: "debug",
      message: `jev judge fields=${fields} lengths=${lengths}`,
    },
  ];
}

export function emitJevDispatchLogs(
  logs: readonly JevDispatchLog[],
  log: (level: JevLogLevel, message: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const debug = env.NOCCIOLO_LOG_LEVEL === "debug";
  for (const entry of logs) {
    if (entry.level === "debug" && !debug) {
      continue;
    }
    log(entry.level, entry.message);
  }
}
