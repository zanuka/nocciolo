import { z } from "zod";

export const DockerConfigSchema = z.object({
  containerName: z.string().min(1),
  volumeName: z.string().min(1).optional(),
});

export const StoreConfigSchema = z.object({
  allowlist: z.array(z.string().min(1)).default([]),
});

export const NoccioloConfigSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  provider: z.literal("hindsight"),
  bankId: z.string().min(1),
  root: z.string().min(1),
  createdAt: z.string().datetime(),
  hindsightBaseUrl: z.string().url().optional(),
  docker: DockerConfigSchema.optional(),
  store: StoreConfigSchema.optional(),
});

export type DockerConfig = z.infer<typeof DockerConfigSchema>;
export type StoreConfig = z.infer<typeof StoreConfigSchema>;
export type NoccioloConfig = z.infer<typeof NoccioloConfigSchema>;

export function createDefaultConfig(input: {
  name: string;
  root?: string;
  bankId?: string;
  hindsightBaseUrl?: string;
  docker?: DockerConfig;
}): NoccioloConfig {
  const bankId = input.bankId ?? slugify(input.name);
  const config: NoccioloConfig = {
    version: 1,
    name: input.name,
    provider: "hindsight",
    bankId,
    root: input.root ?? ".",
    createdAt: new Date().toISOString(),
  };
  if (input.hindsightBaseUrl !== undefined) {
    config.hindsightBaseUrl = input.hindsightBaseUrl;
  }
  if (input.docker !== undefined) {
    config.docker = input.docker;
  }
  return config;
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "project"
  );
}

export function normalizeResourceName(value: string): string {
  const slug = slugify(value);
  if (!slug || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return "project";
  }
  return slug;
}

export function defaultVolumeName(containerName: string): string {
  return `${containerName}-data`;
}
