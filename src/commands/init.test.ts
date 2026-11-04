import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInit } from "./init.js";

describe("runInit", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "orto-init-"));
    dirs.push(dir);
    return dir;
  }

  it("uses flags without prompting when --yes is set", async () => {
    const root = await tempProject();
    const result = await runInit({
      cwd: root,
      yes: true,
      name: "Fixture App",
      bankId: "fixture-bank",
      containerName: "hindsight",
    });

    expect(result.bankId).toBe("fixture-bank");
    expect(result.containerName).toBe("hindsight");
    expect(result.volumeName).toBe("hindsight-data");

    const raw = await readFile(join(root, ".orto", "config.json"), "utf8");
    const config = JSON.parse(raw) as {
      bankId: string;
      docker: { containerName: string; volumeName: string };
    };
    expect(config.bankId).toBe("fixture-bank");
    expect(config.docker).toEqual({
      containerName: "hindsight",
      volumeName: "hindsight-data",
    });
  });

  it("defaults bank id from project name and container to hindsight", async () => {
    const root = await tempProject();
    const result = await runInit({
      cwd: root,
      yes: true,
      name: "My Cool App",
    });

    expect(result.bankId).toBe("my-cool-app");
    expect(result.containerName).toBe("hindsight");
    expect(result.volumeName).toBe("hindsight-data");
  });

  it("dry-run does not write files", async () => {
    const root = await tempProject();
    const result = await runInit({
      cwd: root,
      dryRun: true,
      yes: true,
      bankId: "preview-bank",
    });

    expect(result.dryRun).toBe(true);
    expect(result.bankId).toBe("preview-bank");
    await expect(
      readFile(join(root, ".orto", "config.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("slugifies messy bank and container names from flags", async () => {
    const root = await tempProject();
    const result = await runInit({
      cwd: root,
      yes: true,
      bankId: "Acme Brain!",
      containerName: "Team Hindsight",
    });

    expect(result.bankId).toBe("acme-brain");
    expect(result.containerName).toBe("team-hindsight");
    expect(result.volumeName).toBe("team-hindsight-data");
  });
});
