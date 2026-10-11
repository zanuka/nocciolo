import { describe, expect, it, vi } from "vitest";
import { HindsightClient } from "./client.js";
import { applyBankTemplate } from "./apply.js";
import { generateHindsightBankTemplate } from "./template.js";

describe("applyBankTemplate", () => {
  it("dry-run lists existing resources read-only and reports create vs update", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (url.endsWith("/directives") && method === "GET") {
        return new Response(JSON.stringify({ items: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/mental-models") && method === "GET") {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "project-context",
                name: "Project Context",
                tags: ["nocciolo"],
              },
            ],
            total: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new HindsightClient({
      baseUrl: "http://localhost:8888",
      fetchImpl,
    });
    const template = generateHindsightBankTemplate({
      projectName: "Demo",
      bankId: "demo",
    });

    const result = await applyBankTemplate({
      client,
      bankId: "demo",
      projectName: "Demo",
      template,
      dryRun: true,
    });

    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(result.steps.some((s) => s.kind === "bank")).toBe(true);
    expect(
      result.steps.find(
        (s) => s.kind === "mental_model" && s.id === "project-context",
      )?.action,
    ).toBe("update");
    expect(
      result.steps.find(
        (s) => s.kind === "mental_model" && s.id === "architecture-decisions",
      )?.action,
    ).toBe("create");
  });

  it("creates bank, config, directives, and mental models", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const rawBody = init?.body;
      calls.push({
        method,
        url,
        ...(typeof rawBody === "string"
          ? { body: JSON.parse(rawBody) as unknown }
          : {}),
      });

      if (url.endsWith("/directives") && method === "GET") {
        return new Response(JSON.stringify({ items: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/mental-models") && method === "GET") {
        return new Response(JSON.stringify({ items: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "PUT" || method === "PATCH" || method === "POST") {
        return new Response(
          JSON.stringify({
            bank_id: "demo",
            name: "Demo",
            mission: "",
            disposition: { skepticism: 4, literalism: 4, empathy: 2 },
            id: "created",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new HindsightClient({
      baseUrl: "http://localhost:8888",
      fetchImpl,
    });
    const template = generateHindsightBankTemplate({
      projectName: "Demo",
      bankId: "demo",
    });

    const result = await applyBankTemplate({
      client,
      bankId: "demo",
      projectName: "Demo",
      template,
    });

    expect(calls.some((c) => c.method === "PUT" && c.url.includes("/banks/demo"))).toBe(
      true,
    );
    expect(
      calls.some((c) => c.method === "PATCH" && c.url.endsWith("/config")),
    ).toBe(true);
    expect(
      calls.filter((c) => c.method === "POST" && c.url.endsWith("/directives"))
        .length,
    ).toBe(template.directives.length);
    const mentalModelCreates = calls.filter(
      (c) => c.method === "POST" && c.url.endsWith("/mental-models"),
    );
    expect(mentalModelCreates.length).toBe(template.mental_models.length);
    const architectureCreate = mentalModelCreates.find((c) => {
      const body = c.body as { id?: string } | undefined;
      return body?.id === "architecture-decisions";
    });
    expect(architectureCreate?.body).toMatchObject({
      tags: ["knowledge:architecture", "knowledge:decision"],
      trigger: { tags_match: "any" },
    });
    expect(result.steps.every((s) => s.action === "create" || s.action === "update")).toBe(
      true,
    );
  });

  it("updates existing mental models with tags and tags_match", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const rawBody = init?.body;
      calls.push({
        method,
        url,
        ...(typeof rawBody === "string"
          ? { body: JSON.parse(rawBody) as unknown }
          : {}),
      });

      if (url.endsWith("/directives") && method === "GET") {
        return new Response(JSON.stringify({ items: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/mental-models") && method === "GET") {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "architecture-decisions",
                name: "Old Architecture",
                tags: ["architecture"],
              },
              {
                id: "project-context",
                name: "Project Context",
                tags: ["project"],
              },
              {
                id: "coding-standards",
                name: "Coding Standards",
                tags: ["standards"],
              },
            ],
            total: 3,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (method === "PUT" || method === "PATCH" || method === "POST") {
        return new Response(JSON.stringify({ id: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new HindsightClient({
      baseUrl: "http://localhost:8888",
      fetchImpl,
    });
    const template = generateHindsightBankTemplate({
      projectName: "Demo",
      bankId: "demo",
    });

    const result = await applyBankTemplate({
      client,
      bankId: "demo",
      projectName: "Demo",
      template,
    });

    const updates = calls.filter(
      (c) =>
        c.method === "PATCH" &&
        c.url.includes("/mental-models/architecture-decisions"),
    );
    expect(updates.length).toBe(1);
    expect(updates[0]?.body).toMatchObject({
      tags: ["knowledge:architecture", "knowledge:decision"],
      trigger: {
        refresh_after_consolidation: true,
        tags_match: "any",
      },
    });
    expect(
      result.steps.filter(
        (s) => s.kind === "mental_model" && s.action === "update",
      ).length,
    ).toBe(3);
  });
});
