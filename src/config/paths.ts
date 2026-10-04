import { join } from "node:path";

export const NOCCIOLO_DIR = ".nocciolo";
export const CONFIG_FILENAME = "config.json";
export const SHARE_FILENAME = "share.json";
export const BANK_TEMPLATE_FILENAME = "bank-template.json";

export function noccioloDir(projectRoot: string): string {
  return join(projectRoot, NOCCIOLO_DIR);
}

export function configPath(projectRoot: string): string {
  return join(noccioloDir(projectRoot), CONFIG_FILENAME);
}

export function sharePath(projectRoot: string): string {
  return join(noccioloDir(projectRoot), SHARE_FILENAME);
}

export function bankTemplatePath(projectRoot: string): string {
  return join(noccioloDir(projectRoot), "hindsight", BANK_TEMPLATE_FILENAME);
}

export function hindsightDir(projectRoot: string): string {
  return join(noccioloDir(projectRoot), "hindsight");
}
