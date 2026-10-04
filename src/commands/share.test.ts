import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runShare } from "./share.js";

describe("runShare", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempProject(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nocciolo-share-"));
    dirs.push(root);
    await mkdir(join(root, ".nocciolo"), { recursive: true });
    await writeFile(
      join(root, ".nocciolo", "config.json"),
      JSON.stringify({
        version: 1,
        name: "fixture",
        provider: "hindsight",
        bankId: "fixture-bank",
        root: ".",
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );
    return root;
  }

  it("writes share.json for lan with baseUrl", async () => {
    const root = await tempProject();
    const result = await runShare({
      cwd: root,
      profile: "lan",
      baseUrl: "http://192.168.1.50:8888",
    });
    expect(result.wrote).toBe(true);
    expect(result.profile).toBe("lan");
    expect(result.baseUrl).toBe("http://192.168.1.50:8888");
    expect(result.serverName).toBe("hindsight-fixture-bank");

    const share = JSON.parse(
      await readFile(join(root, ".nocciolo", "share.json"), "utf8"),
    ) as { profile: string; baseUrl: string };
    expect(share.profile).toBe("lan");
    expect(share.baseUrl).toBe("http://192.168.1.50:8888");

    const config = JSON.parse(
      await readFile(join(root, ".nocciolo", "config.json"), "utf8"),
    ) as { deploymentProfile?: string };
    expect(config.deploymentProfile).toBe("lan");
  });

  it("dry-run does not write share.json", async () => {
    const root = await tempProject();
    await runShare({
      cwd: root,
      profile: "hindsight-cloud",
      dryRun: true,
    });
    await expect(
      readFile(join(root, ".nocciolo", "share.json"), "utf8"),
    ).rejects.toThrow();
  });
});
