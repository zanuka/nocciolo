import { join } from "node:path";

export const ORTO_DIR = ".orto";
export const CONFIG_FILENAME = "config.json";
export const SHARE_FILENAME = "share.json";
export const BANK_TEMPLATE_FILENAME = "bank-template.json";

export function ortoDir(projectRoot: string): string {
  return join(projectRoot, ORTO_DIR);
}

export function configPath(projectRoot: string): string {
  return join(ortoDir(projectRoot), CONFIG_FILENAME);
}

export function sharePath(projectRoot: string): string {
  return join(ortoDir(projectRoot), SHARE_FILENAME);
}

export function bankTemplatePath(projectRoot: string): string {
  return join(ortoDir(projectRoot), "hindsight", BANK_TEMPLATE_FILENAME);
}

export function hindsightDir(projectRoot: string): string {
  return join(ortoDir(projectRoot), "hindsight");
}
