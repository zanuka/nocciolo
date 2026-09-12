import { homedir } from "node:os";
import { join } from "node:path";
import { NoccioloError } from "../utils/errors.js";
import {
  DEFAULT_API_PORT,
  DEFAULT_UI_PORT,
  formatDockerArgv,
} from "./hindsight.js";

export const HINDSIGHT_IMAGE_REPO = "ghcr.io/vectorize-io/hindsight";
export const PG0_MOUNT_PATH = "/home/hindsight/.pg0";
export const VOLUME_TARBALL_NAME = "hindsight-data-volume.tar.gz";

export interface BankManifestEntry {
  bank_id: string;
  fact_count: number;
  name?: string;
}

export interface FactCountRow {
  bank_id: string;
  before: number;
  after: number;
  ok: boolean;
}

export interface FactCountDiffResult {
  ok: boolean;
  rows: FactCountRow[];
  missingAfter: string[];
  unexpectedAfter: string[];
}

export interface DockerMountInfo {
  name?: string;
  source?: string;
  destination: string;
  type?: string;
}

export interface HostPortBinding {
  hostIp?: string;
  hostPort: string;
}

export interface InspectedHindsightContainer {
  name: string;
  image: string;
  env: string[];
  portBindings: Record<string, HostPortBinding[]>;
  mounts: DockerMountInfo[];
  restartPolicyName: string;
  pg0VolumeName: string;
  apiHostPort: number;
  uiHostPort: number;
}

export interface RecreatePlan {
  argv: string[];
  display: string;
  containerName: string;
  image: string;
  volumeName: string;
  apiHostPort: number;
  uiHostPort: number;
  envCount: number;
}

export interface VolumeTarballPlan {
  argv: string[];
  display: string;
  hostTarballPath: string;
}

export interface BackupPlanSummary {
  backupDir: string;
  volumeTarball: VolumeTarballPlan;
  adminBackupZipName: string;
  banksDir: string;
  documentTransfersDir: string;
  manifestPath: string;
  readmePath: string;
}

const SECRET_ENV_PATTERN =
  /(API_KEY|ACCESS_KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL|PRIVATE_KEY)/i;

export function normalizeVersionTag(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) {
    throw new NoccioloError(
      "Target version is empty",
      "Pass a pinned tag with --to, e.g. --to 0.9.2",
    );
  }
  if (trimmed === "latest" || trimmed.endsWith(":latest")) {
    throw new NoccioloError(
      "Refusing to upgrade to :latest",
      "Pass a pinned image tag with --to, e.g. --to 0.9.2",
    );
  }
  const withoutRepo = trimmed.includes("/")
    ? (trimmed.split(":").pop() ?? trimmed)
    : trimmed;
  return withoutRepo.replace(/^v/i, "");
}

export function pinnedHindsightImage(version: string): string {
  const tag = normalizeVersionTag(version);
  return `${HINDSIGHT_IMAGE_REPO}:${tag}`;
}

export function versionsEqual(a: string, b: string): boolean {
  return normalizeVersionTag(a) === normalizeVersionTag(b);
}

export function imageTagFromImage(image: string): string | undefined {
  const idx = image.lastIndexOf(":");
  if (idx <= 0) {
    return undefined;
  }
  return image.slice(idx + 1);
}

export function isSecretEnvKey(key: string): boolean {
  return SECRET_ENV_PATTERN.test(key);
}

export function parseEnvList(env: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of env) {
    const eq = entry.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = entry.slice(0, eq);
    out[key] = entry.slice(eq + 1);
  }
  return out;
}

export function envRecordToList(env: Record<string, string>): string[] {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

export function preserveContainerEnv(env: string[]): string[] {
  return [...env];
}

export function maskEnvValueForDisplay(key: string, value: string): string {
  if (isSecretEnvKey(key)) {
    return "***";
  }
  return value;
}

export function formatEnvForDisplay(env: string[]): string[] {
  return env.map((entry) => {
    const eq = entry.indexOf("=");
    if (eq <= 0) {
      return entry;
    }
    const key = entry.slice(0, eq);
    const value = entry.slice(eq + 1);
    return `${key}=${maskEnvValueForDisplay(key, value)}`;
  });
}

export function formatBackupTimestamp(date: Date): string {
  const iso = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  return iso.replace(/[:.]/g, "-");
}

export function defaultBackupDir(options: {
  toVersion: string;
  timestamp?: Date;
  homeDir?: string;
}): string {
  const stamp = formatBackupTimestamp(options.timestamp ?? new Date());
  const tag = normalizeVersionTag(options.toVersion);
  const home = options.homeDir ?? homedir();
  return join(home, "hindsight-bank-backups", `pre-${tag}-${stamp}`);
}

export function buildBackupPlan(options: {
  backupDir: string;
  volumeName: string;
}): BackupPlanSummary {
  const backupDir = options.backupDir;
  const hostTarballPath = join(backupDir, VOLUME_TARBALL_NAME);
  const volumeTarball = buildVolumeTarballPlan({
    volumeName: options.volumeName,
    backupDir,
  });
  return {
    backupDir,
    volumeTarball,
    adminBackupZipName: `hindsight-admin-backup.zip`,
    banksDir: join(backupDir, "banks"),
    documentTransfersDir: join(backupDir, "document-transfers"),
    manifestPath: join(backupDir, "banks-manifest.json"),
    readmePath: join(backupDir, "README.md"),
  };
}

export function buildVolumeTarballPlan(options: {
  volumeName: string;
  backupDir: string;
}): VolumeTarballPlan {
  const hostTarballPath = join(options.backupDir, VOLUME_TARBALL_NAME);
  const argv = [
    "docker",
    "run",
    "--rm",
    "-v",
    `${options.volumeName}:/data:ro`,
    "-v",
    `${options.backupDir}:/backup`,
    "alpine",
    "tar",
    "czf",
    `/backup/${VOLUME_TARBALL_NAME}`,
    "-C",
    "/data",
    ".",
  ];
  return {
    argv,
    display: formatDockerArgv(argv),
    hostTarballPath,
  };
}

export function findPg0VolumeName(mounts: DockerMountInfo[]): string {
  const match = mounts.find((m) => m.destination === PG0_MOUNT_PATH);
  if (!match?.name) {
    throw new NoccioloError(
      `No named volume mounted at ${PG0_MOUNT_PATH}`,
      "Confirm with `docker inspect <container> --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{\"\\n\"}}{{end}}'`. Do not remove the volume.",
    );
  }
  return match.name;
}

export function hostPortForContainerPort(
  portBindings: Record<string, HostPortBinding[]>,
  containerPort: number,
  fallback: number,
): number {
  const key = `${containerPort}/tcp`;
  const bindings = portBindings[key];
  const first = bindings?.[0];
  if (!first?.hostPort) {
    return fallback;
  }
  const parsed = Number(first.hostPort);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseDockerInspect(
  raw: unknown,
  expectedName?: string,
): InspectedHindsightContainer {
  const list = Array.isArray(raw) ? raw : [raw];
  const entry = list[0] as Record<string, unknown> | undefined;
  if (!entry || typeof entry !== "object") {
    throw new NoccioloError(
      "docker inspect returned no container",
      "Ensure the Hindsight container exists: `nocciolo docker status`.",
    );
  }

  const nameRaw = String(entry.Name ?? "").replace(/^\//, "");
  const name = nameRaw || expectedName || "hindsight";
  const config = (entry.Config ?? {}) as Record<string, unknown>;
  const hostConfig = (entry.HostConfig ?? {}) as Record<string, unknown>;
  const image = String(config.Image ?? "");
  const env = Array.isArray(config.Env)
    ? config.Env.filter((e): e is string => typeof e === "string")
    : [];

  const portBindingsRaw =
    (hostConfig.PortBindings as Record<string, unknown> | null | undefined) ??
    {};
  const portBindings: Record<string, HostPortBinding[]> = {};
  for (const [port, bindings] of Object.entries(portBindingsRaw)) {
    if (!Array.isArray(bindings)) {
      continue;
    }
    portBindings[port] = bindings
      .map((b) => {
        const row = b as Record<string, unknown>;
        const hostPort = String(row.HostPort ?? "");
        if (!hostPort) {
          return undefined;
        }
        const binding: HostPortBinding = { hostPort };
        if (typeof row.HostIp === "string" && row.HostIp.length > 0) {
          binding.hostIp = row.HostIp;
        }
        return binding;
      })
      .filter((b): b is HostPortBinding => b !== undefined);
  }

  const mountsRaw = Array.isArray(entry.Mounts) ? entry.Mounts : [];
  const mounts: DockerMountInfo[] = mountsRaw.map((m) => {
    const row = m as Record<string, unknown>;
    const info: DockerMountInfo = {
      destination: String(row.Destination ?? ""),
    };
    if (typeof row.Name === "string" && row.Name.length > 0) {
      info.name = row.Name;
    }
    if (typeof row.Source === "string" && row.Source.length > 0) {
      info.source = row.Source;
    }
    if (typeof row.Type === "string" && row.Type.length > 0) {
      info.type = row.Type;
    }
    return info;
  });

  const restartPolicy = (hostConfig.RestartPolicy ?? {}) as Record<
    string,
    unknown
  >;
  const restartPolicyName =
    typeof restartPolicy.Name === "string" && restartPolicy.Name.length > 0
      ? restartPolicy.Name
      : "unless-stopped";

  const pg0VolumeName = findPg0VolumeName(mounts);
  const apiHostPort = hostPortForContainerPort(
    portBindings,
    8888,
    DEFAULT_API_PORT,
  );
  const uiHostPort = hostPortForContainerPort(
    portBindings,
    9999,
    DEFAULT_UI_PORT,
  );

  return {
    name,
    image,
    env,
    portBindings,
    mounts,
    restartPolicyName,
    pg0VolumeName,
    apiHostPort,
    uiHostPort,
  };
}

export function buildRecreatePlan(options: {
  inspected: InspectedHindsightContainer;
  targetImage: string;
}): RecreatePlan {
  const { inspected, targetImage } = options;
  const env = preserveContainerEnv(inspected.env);
  const argv: string[] = [
    "docker",
    "run",
    "-d",
    "--name",
    inspected.name,
    "--restart",
    inspected.restartPolicyName || "unless-stopped",
  ];

  pushPortBinding(argv, inspected.portBindings, 8888, inspected.apiHostPort);
  pushPortBinding(argv, inspected.portBindings, 9999, inspected.uiHostPort);

  argv.push("-v", `${inspected.pg0VolumeName}:${PG0_MOUNT_PATH}`);

  const displayArgv = [...argv];
  for (const entry of env) {
    argv.push("-e", entry);
    const eq = entry.indexOf("=");
    if (eq <= 0) {
      displayArgv.push("-e", entry);
      continue;
    }
    const key = entry.slice(0, eq);
    const value = entry.slice(eq + 1);
    displayArgv.push("-e", `${key}=${maskEnvValueForDisplay(key, value)}`);
  }

  argv.push(targetImage);
  displayArgv.push(targetImage);

  return {
    argv,
    display: formatDockerArgv(displayArgv),
    containerName: inspected.name,
    image: targetImage,
    volumeName: inspected.pg0VolumeName,
    apiHostPort: inspected.apiHostPort,
    uiHostPort: inspected.uiHostPort,
    envCount: env.length,
  };
}

function pushPortBinding(
  argv: string[],
  portBindings: Record<string, HostPortBinding[]>,
  containerPort: number,
  fallbackHostPort: number,
): void {
  const key = `${containerPort}/tcp`;
  const bindings = portBindings[key];
  if (bindings && bindings.length > 0) {
    for (const binding of bindings) {
      const host = binding.hostIp
        ? `${binding.hostIp}:${binding.hostPort}`
        : binding.hostPort;
      argv.push("-p", `${host}:${containerPort}`);
    }
    return;
  }
  argv.push("-p", `${fallbackHostPort}:${containerPort}`);
}

export function normalizeBankManifest(
  banks: Array<{
    bank_id?: string;
    bankId?: string;
    fact_count?: number;
    factCount?: number;
    name?: string;
  }>,
): BankManifestEntry[] {
  return banks
    .map((bank) => {
      const bank_id = bank.bank_id ?? bank.bankId;
      if (!bank_id) {
        return undefined;
      }
      const fact_count = Number(bank.fact_count ?? bank.factCount ?? 0);
      const entry: BankManifestEntry = {
        bank_id,
        fact_count: Number.isFinite(fact_count) ? fact_count : 0,
      };
      if (typeof bank.name === "string" && bank.name.length > 0) {
        entry.name = bank.name;
      }
      return entry;
    })
    .filter((b): b is BankManifestEntry => b !== undefined)
    .sort((a, b) => a.bank_id.localeCompare(b.bank_id));
}

export function diffBankFactCounts(
  before: BankManifestEntry[],
  after: BankManifestEntry[],
): FactCountDiffResult {
  const beforeMap = new Map(before.map((b) => [b.bank_id, b.fact_count]));
  const afterMap = new Map(after.map((b) => [b.bank_id, b.fact_count]));
  const ids = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const rows: FactCountRow[] = [];
  const missingAfter: string[] = [];
  const unexpectedAfter: string[] = [];

  for (const id of [...ids].sort()) {
    const hasBefore = beforeMap.has(id);
    const hasAfter = afterMap.has(id);
    if (hasBefore && !hasAfter) {
      missingAfter.push(id);
      rows.push({
        bank_id: id,
        before: beforeMap.get(id) ?? 0,
        after: -1,
        ok: false,
      });
      continue;
    }
    if (!hasBefore && hasAfter) {
      unexpectedAfter.push(id);
      rows.push({
        bank_id: id,
        before: -1,
        after: afterMap.get(id) ?? 0,
        ok: false,
      });
      continue;
    }
    const b = beforeMap.get(id) ?? 0;
    const a = afterMap.get(id) ?? 0;
    rows.push({
      bank_id: id,
      before: b,
      after: a,
      ok: b === a,
    });
  }

  return {
    ok:
      missingAfter.length === 0 &&
      unexpectedAfter.length === 0 &&
      rows.every((r) => r.ok),
    rows,
    missingAfter,
    unexpectedAfter,
  };
}

export function formatFactCountTable(rows: FactCountRow[]): string {
  const header = "bank_id | before | after | OK";
  const lines = rows.map((r) => {
    const after = r.after < 0 ? "MISSING" : String(r.after);
    const before = r.before < 0 ? "NEW" : String(r.before);
    return `${r.bank_id} | ${before} | ${after} | ${r.ok ? "OK" : "FAIL"}`;
  });
  return [header, ...lines].join("\n");
}

export function countPendingOperations(statsList: unknown[]): number {
  let total = 0;
  for (const stats of statsList) {
    if (!stats || typeof stats !== "object") {
      continue;
    }
    const row = stats as Record<string, unknown>;
    for (const [key, value] of Object.entries(row)) {
      if (!/pending|processing/i.test(key)) {
        continue;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        total += value;
      }
    }
    const ops = row.operations;
    if (ops && typeof ops === "object") {
      const nested = ops as Record<string, unknown>;
      for (const [key, value] of Object.entries(nested)) {
        if (!/pending|processing/i.test(key)) {
          continue;
        }
        if (typeof value === "number" && Number.isFinite(value)) {
          total += value;
        }
      }
    }
  }
  return total;
}

export function buildBackupReadme(input: {
  timestamp: string;
  fromVersion: string;
  toVersion: string;
  containerName: string;
  volumeName: string;
  banks: BankManifestEntry[];
  projectBankId?: string;
}): string {
  const bankLines = input.banks
    .map((b) => {
      const mark =
        input.projectBankId && b.bank_id === input.projectBankId
          ? " (project bank)"
          : "";
      const name = b.name ? ` (${b.name})` : "";
      return `- \`${b.bank_id}\`${name}: ${b.fact_count} facts${mark}`;
    })
    .join("\n");

  return `# Hindsight pre-upgrade backup

Timestamp: ${input.timestamp}
From version: ${input.fromVersion}
Target version: ${input.toVersion}
Container: ${input.containerName}
Volume: ${input.volumeName} → ${PG0_MOUNT_PATH}

## Banks

${bankLines || "(none listed)"}

## Artifacts

- \`${VOLUME_TARBALL_NAME}\`: full named-volume tarball (primary restore path)
- \`hindsight-admin-backup.zip\`: full instance backup via \`hindsight-admin backup\` (when available)
- \`banks-manifest.json\`: bank ids and fact counts before upgrade
- \`banks/\`: per-bank stats and HTTP exports
- \`document-transfers/\`: per-bank document-transfer archives when the API returned 200

## Restore

1. Prefer restoring the volume tarball onto the same named volume (do **not** \`docker volume rm\` unless you intend to wipe banks).
2. For portable ZIP restore via Admin CLI, see [hindsight-bank-backup.md](https://github.com/nocciolo-ai/nocciolo/blob/main/docs/hindsight-bank-backup.md).
3. Recreate the container with the previous image tag and the same volume + env if rolling back an upgrade.

Secrets (API keys, tokens) are not written into this README.
`;
}

export function assertNoVolumeDeleteArgv(argv: string[]): void {
  const joined = argv.join(" ");
  if (/\bvolume\s+rm\b/.test(joined) || /\bvolume\s+remove\b/.test(joined)) {
    throw new NoccioloError(
      "Refusing to run a docker volume delete command during upgrade",
      "Upgrade must keep the named data volume. Only the container is recreated.",
    );
  }
}
