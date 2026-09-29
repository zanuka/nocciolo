import { matchGlob } from "./glob.js";

export interface ScannerPolicy {
  include?: readonly string[] | undefined;
  exclude?: readonly string[] | undefined;
  extensions?: readonly string[] | undefined;
}

export const DEFAULT_SCAN_EXTENSIONS = [".md", ".markdown"] as const;

export function effectiveExtensions(policy?: ScannerPolicy): string[] {
  const listed = policy?.extensions?.map((ext) => ext.trim()).filter((ext) => ext.length > 0) ?? [];
  const source = listed.length > 0 ? listed : [...DEFAULT_SCAN_EXTENSIONS];
  return [...new Set(source.map(normalizeExtension))];
}

export function activeInclude(policy?: ScannerPolicy): string[] {
  return policy?.include?.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0) ?? [];
}

export function activeExclude(policy?: ScannerPolicy): string[] {
  return policy?.exclude?.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0) ?? [];
}

export function extensionAllowed(filename: string, extensions: readonly string[]): boolean {
  const lower = filename.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

export function isExcludedPath(relativePath: string, exclude: readonly string[]): boolean {
  const normalized = relativePath.split(/[/\\]/).join("/");
  return exclude.some((pattern) => matchGlob(pattern, normalized));
}

export function matchesInclude(relativePath: string, include: readonly string[]): boolean {
  const normalized = relativePath.split(/[/\\]/).join("/");
  return include.some((pattern) => matchGlob(pattern, normalized));
}

function normalizeExtension(ext: string): string {
  const lower = ext.trim().toLowerCase();
  return lower.startsWith(".") ? lower : `.${lower}`;
}
