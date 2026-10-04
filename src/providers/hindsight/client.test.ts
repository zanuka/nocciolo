import {
  HindsightClient,
  resolveHindsightBaseUrl,
} from "./client.js";

describe("resolveHindsightBaseUrl", () => {
  it("prefers cli over config over env over default", () => {
    expect(
      resolveHindsightBaseUrl({
        cliUrl: "http://cli:1",
        configUrl: "http://config:1",
        env: {
          NOCCIOLO_HINDSIGHT_URL: "http://env:1",
        },
      }),
    ).toBe("http://cli:1");

    expect(
      resolveHindsightBaseUrl({
        configUrl: "http://config:1",
        env: {
          HINDSIGHT_URL: "http://env:1",
        },
      }),
    ).toBe("http://config:1");

    expect(
      resolveHindsightBaseUrl({
        env: {
          HINDSIGHT_URL: "http://env:1",
        },
      }),
    ).toBe("http://env:1");

    expect(resolveHindsightBaseUrl({ env: {} })).toBe("http://localhost:8888");
  });
});

describe("HindsightClient.retain", () => {
  it("posts retain payload to the memories endpoint", async () => {
    const calls: Array<{
      url: string;
      headers: Record<string, string> | undefined;
      body: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        headers: init?.headers as Record<string, string> | undefined,
        body: JSON.parse(String(init?.body)),
      });
      return new Response(
        JSON.stringify({ success: true, bank_id: "nocciolo", items_count: 1 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new HindsightClient({
      baseUrl: "http://localhost:8888/",
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await client.retain("nocciolo", {
      items: [
        {
          content: "Use TypeScript",
          context: "docs",
          document_id: "nocciolo:README.md#goal",
          timestamp: "unset",
          metadata: { source: "README.md" },
          tags: ["nocciolo"],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://localhost:8888/v1/default/banks/nocciolo/memories",
    );
    expect(calls[0]?.headers).toMatchObject({
      Authorization: "Bearer test-key",
    });
    expect(calls[0]?.body).toMatchObject({
      async: false,
      items: [{ document_id: "nocciolo:README.md#goal" }],
    });
  });

  it("throws an actionable error when Hindsight is unreachable", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const client = new HindsightClient({
      baseUrl: "http://localhost:8888",
      fetchImpl,
    });

    await expect(
      client.retain("nocciolo", {
        items: [
          {
            content: "x",
            context: "docs",
            document_id: "id",
            timestamp: "unset",
            metadata: {},
            tags: [],
          },
        ],
      }),
    ).rejects.toThrow(/Failed to reach Hindsight/);
  });
});

describe("HindsightClient.listDocuments", () => {
  it("gets documents with query params", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          items: [{ id: "nocciolo:README.md#goal" }],
          total: 1,
          limit: 50,
          offset: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new HindsightClient({
      baseUrl: "http://localhost:8888",
      apiKey: "k",
      fetchImpl,
    });

    const result = await client.listDocuments("nocciolo", {
      q: "README",
      limit: 50,
      offset: 0,
    });

    expect(result.items).toHaveLength(1);
    expect(calls[0]).toBe(
      "http://localhost:8888/v1/default/banks/nocciolo/documents?q=README&limit=50&offset=0",
    );
  });

  it("paginates listAllDocuments until exhausted", async () => {
    const offsets: number[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get("offset") ?? "0");
      offsets.push(offset);
      const items =
        offset === 0
          ? [{ id: "a" }, { id: "b" }]
          : offset === 2
            ? [{ id: "c" }]
            : [];
      return new Response(
        JSON.stringify({
          items,
          total: 3,
          limit: 2,
          offset,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new HindsightClient({
      baseUrl: "http://localhost:8888",
      fetchImpl,
    });
    const all = await client.listAllDocuments("nocciolo", { limit: 2 });
    expect(all.map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(offsets).toEqual([0, 2]);
  });
});

describe("HindsightClient.deleteDocument", () => {
  it("encodes nocciolo document ids in the path", async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), method: init?.method });
      return new Response(
        JSON.stringify({
          success: true,
          message: "deleted",
          document_id: "nocciolo:docs/dev/foo.md#some-section",
          memory_units_deleted: 2,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new HindsightClient({
      baseUrl: "http://localhost:8888",
      fetchImpl,
    });
    const result = await client.deleteDocument(
      "nocciolo",
      "nocciolo:docs/dev/foo.md#some-section",
    );

    expect(result.success).toBe(true);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(
      "http://localhost:8888/v1/default/banks/nocciolo/documents/nocciolo%3Adocs%2Fdev%2Ffoo.md%23some-section",
    );
  });

  it("throws when delete fails", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("nope", { status: 404, statusText: "Not Found" });
    const client = new HindsightClient({
      baseUrl: "http://localhost:8888",
      fetchImpl,
    });
    await expect(client.deleteDocument("nocciolo", "missing")).rejects.toThrow(
      /Hindsight delete document failed/,
    );
  });
});
