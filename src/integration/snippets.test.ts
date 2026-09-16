import { describe, expect, it } from "vitest";
import { buildSingleBankMcpUrl } from "./mcp-url.js";
import {
  filterSnippets,
  generateMcpSnippets,
  parseHarnessList,
} from "./snippets.js";
import {
  AGENTS_BANK_BEGIN,
  buildCursorBankRule,
  upsertAgentsBankSection,
} from "./agent-rules.js";
import { mergeMcpServers } from "./write.js";

describe("buildSingleBankMcpUrl", () => {
  it("builds a trailing-slash single-bank MCP path", () => {
    expect(buildSingleBankMcpUrl("http://localhost:8888", "nocciolo")).toBe(
      "http://localhost:8888/mcp/nocciolo/",
    );
  });

  it("strips trailing slashes from the base URL", () => {
    expect(buildSingleBankMcpUrl("http://localhost:8888/", "bank")).toBe(
      "http://localhost:8888/mcp/bank/",
    );
  });
});

describe("generateMcpSnippets", () => {
  const input = {
    baseUrl: "http://localhost:8888",
    bankId: "nocciolo",
    projectName: "Nocciolo",
  };

  it("emits Cursor JSON with the single-bank URL", () => {
    const cursor = generateMcpSnippets(input).find((s) => s.harness === "cursor");
    expect(cursor).toBeDefined();
    const parsed = JSON.parse(cursor!.body) as {
      mcpServers: { hindsight: { url: string } };
    };
    expect(parsed.mcpServers.hindsight.url).toBe(
      "http://localhost:8888/mcp/nocciolo/",
    );
  });

  it("emits Roo with streamable-http type", () => {
    const roo = generateMcpSnippets(input).find((s) => s.harness === "roo");
    const parsed = JSON.parse(roo!.body) as {
      mcpServers: { hindsight: { type: string; url: string } };
    };
    expect(parsed.mcpServers.hindsight.type).toBe("streamable-http");
  });

  it("emits Claude Code shell with http transport", () => {
    const claude = generateMcpSnippets(input).find(
      (s) => s.harness === "claude-code",
    );
    expect(claude!.body).toContain("claude mcp add --transport http");
    expect(claude!.body).toContain("http://localhost:8888/mcp/nocciolo/");
  });

  it("emits Codex TOML with mcp_servers", () => {
    const codex = generateMcpSnippets(input).find((s) => s.harness === "codex");
    expect(codex!.body).toContain("[mcp_servers.hindsight]");
    expect(codex!.body).toContain('url = "http://localhost:8888/mcp/nocciolo/"');
  });

  it("uses env placeholders for auth when writing-safe", () => {
    const cursor = generateMcpSnippets({
      ...input,
      includeAuth: true,
    }).find((s) => s.harness === "cursor");
    const parsed = JSON.parse(cursor!.body) as {
      mcpServers: { hindsight: { headers: { Authorization: string } } };
    };
    expect(parsed.mcpServers.hindsight.headers.Authorization).toBe(
      "Bearer ${env:NOCCIOLO_HINDSIGHT_API_KEY}",
    );
  });

  it("emits Firstmate as a print-only shell snippet with the single-bank URL", () => {
    const firstmate = generateMcpSnippets(input).find(
      (s) => s.harness === "firstmate",
    );
    expect(firstmate).toBeDefined();
    expect(firstmate!.format).toBe("shell");
    expect(firstmate!.body).toContain("cd ");
    expect(firstmate!.body).toContain("claude mcp add --transport http");
    expect(firstmate!.body).toContain("http://localhost:8888/mcp/nocciolo/");
    expect(firstmate!.notes.join(" ")).toMatch(/Firstmate home/);
    expect(firstmate!.notes.join(" ")).toMatch(/Captain-only/);
    expect(firstmate!.notes.join(" ")).toMatch(/scouts or ships/);
    expect(firstmate!.notes.join(" ")).toMatch(/not write MCP config/);
    expect(firstmate!.notes.join(" ")).toMatch(/Register this git project/);
  });

  it("adds env placeholder auth headers for Firstmate with --include-auth", () => {
    const firstmate = generateMcpSnippets({
      ...input,
      includeAuth: true,
    }).find((s) => s.harness === "firstmate");
    expect(firstmate!.body).toContain(
      '--header "Authorization: Bearer ${NOCCIOLO_HINDSIGHT_API_KEY}"',
    );
  });

  it("filters harnesses", () => {
    const all = generateMcpSnippets(input);
    const filtered = filterSnippets(all, ["cursor", "codex"]);
    expect(filtered.map((s) => s.harness)).toEqual(["cursor", "codex"]);
  });
});

describe("parseHarnessList", () => {
  it("defaults to all", () => {
    expect(parseHarnessList(undefined).length).toBeGreaterThan(3);
  });

  it("rejects unknown harnesses", () => {
    expect(() => parseHarnessList("cursor,nope")).toThrow(/Unknown harness/);
  });

  it("still errors on --harness nope and lists firstmate in the valid harnesses", () => {
    expect(() => parseHarnessList("nope")).toThrow(/Unknown harness "nope"/);
    try {
      parseHarnessList("nope");
      throw new Error("expected parseHarnessList to throw");
    } catch (error) {
      expect((error as Error).message).toContain("firstmate");
    }
  });
});

describe("agent rules", () => {
  it("upserts AGENTS.md section idempotently", () => {
    const first = upsertAgentsBankSection("# Title\n\nBody.\n", {
      projectName: "Nocciolo",
      bankId: "nocciolo",
      baseUrl: "http://localhost:8888",
    });
    expect(first).toContain(AGENTS_BANK_BEGIN);
    expect(first).toContain("mcp/nocciolo/");

    const second = upsertAgentsBankSection(first, {
      projectName: "Nocciolo",
      bankId: "nocciolo",
      baseUrl: "http://localhost:9999",
    });
    expect(second.match(/<!-- nocciolo:hindsight-bank -->/g)?.length).toBe(1);
    expect(second).toContain("http://localhost:9999/mcp/nocciolo/");
    expect(second).toContain("# Title");
  });

  it("builds a Cursor alwaysApply rule", () => {
    const rule = buildCursorBankRule({
      projectName: "Nocciolo",
      bankId: "nocciolo",
      baseUrl: "http://localhost:8888",
    });
    expect(rule).toContain("alwaysApply: true");
    expect(rule).toContain("nocciolo");
  });
});

describe("mergeMcpServers", () => {
  it("merges without clobbering other servers", () => {
    const merged = mergeMcpServers(
      {
        mcpServers: {
          other: { url: "http://example" },
        },
      },
      {
        mcpServers: {
          hindsight: { url: "http://localhost:8888/mcp/nocciolo/" },
        },
      },
      false,
    );
    expect(merged.mcpServers?.other).toEqual({ url: "http://example" });
    expect(merged.mcpServers?.hindsight).toEqual({
      url: "http://localhost:8888/mcp/nocciolo/",
    });
  });

  it("refuses overwrite without force", () => {
    expect(() =>
      mergeMcpServers(
        { mcpServers: { hindsight: { url: "old" } } },
        { mcpServers: { hindsight: { url: "new" } } },
        false,
      ),
    ).toThrow(/already exists/);
  });
});
