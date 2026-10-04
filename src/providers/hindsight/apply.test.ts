import { describe, expect, it, vi } from "vitest";
import { HindsightClient } from "./client.js";
import { applyBankTemplate } from "./apply.js";
import { generateHindsightBankTemplate } from "./template.js";

describe("applyBankTemplate", () => {
  it("dry-run reports create steps without calling the network", async () => {
    const fetchImpl = vi.fn();
    const client = new HindsightClient({
      baseUrl: "http://localhost:8888",
      fetchImpl: fetchImpl as unknown as typeof fetch,
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

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.steps.some((s) => s.kind === "bank")).toBe(true);
    expect(result.steps.filter((s) => s.kind === "directive").length).toBe(
      template.directives.length,
    );
    expect(result.steps.filter((s) => s.kind === "mental_model").length).toBe(
      template.mental_models.length,
    );
  });

  it("creates bank, config, directives, and mental models", async () => {
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
    expect(
      calls.filter(
        (c) => c.method === "POST" && c.url.endsWith("/mental-models"),
      ).length,
    ).toBe(template.mental_models.length);
    expect(result.steps.every((s) => s.action === "create" || s.action === "update")).toBe(
      true,
    );
  });
});
