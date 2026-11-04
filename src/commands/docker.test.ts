import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDockerNames } from "./docker.js";

describe("resolveDockerNames", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("prefers explicit CLI container name", async () => {
    const resolved = await resolveDockerNames({
      containerName: "custom-hindsight",
    });
    expect(resolved).toEqual({
      containerName: "custom-hindsight",
      volumeName: "custom-hindsight-data",
    });
  });

  it("reads docker names from project config", async () => {
    const root = await mkdtemp(join(tmpdir(), "orto-docker-"));
    dirs.push(root);
    await mkdir(join(root, ".orto"), { recursive: true });
    await writeFile(
      join(root, ".orto", "config.json"),
      JSON.stringify({
        version: 1,
        name: "fixture",
        provider: "hindsight",
        bankId: "fixture-bank",
        root: ".",
        createdAt: new Date().toISOString(),
        docker: {
          containerName: "team-hindsight",
          volumeName: "team-hindsight-data",
        },
      }),
      "utf8",
    );

    const resolved = await resolveDockerNames({ cwd: root });
    expect(resolved).toEqual({
      containerName: "team-hindsight",
      volumeName: "team-hindsight-data",
    });
  });

  it("falls back to hindsight defaults without config", async () => {
    const root = await mkdtemp(join(tmpdir(), "orto-docker-"));
    dirs.push(root);
    const resolved = await resolveDockerNames({ cwd: root });
    expect(resolved).toEqual({
      containerName: "hindsight",
      volumeName: "hindsight-data",
    });
  });
});
