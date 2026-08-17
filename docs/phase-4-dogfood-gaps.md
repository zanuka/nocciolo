# Phase 4 dogfood gaps — Strumentario pass

Lessons from dogfooding Nocciolo against [Strumentario](https://github.com/zanuka/strumentario): full `init` → `configure` → template import → `seed` → `mcp` on a **shared** local Hindsight server (`suchconfig-hindsight`) with bank id `strumentario`, alongside the existing `nocciolo` bank.

This capture feeds Phase 4 (team sharing & deployment profiles). It is not a substitute for the deployment-profile work — it names the product gaps that sharing must solve.

Companion: [dev-testing.md](./dev-testing.md), [dev-workflow.md](./dev-workflow.md), [cli-architecture.md](./cli-architecture.md).

## What worked

| Step | Outcome |
|------|---------|
| Shared Docker server | One container hosts both `nocciolo` and `strumentario` banks |
| `init` bank id + container | Distinct `bankId`; `docker.containerName` points at existing server |
| `configure` | Wrote `.nocciolo/hindsight/bank-template.json` for the project |
| Live `seed` | Retained durable README / AGENTS / docs candidates with provenance |
| HTTP recall | `POST …/banks/strumentario/memories/recall` returned Strumentario facts |
| MCP endpoint | `http://localhost:8888/mcp/strumentario/` initializes when auth is correct |
| Agent wiring files | `--write` / `--write-agents` / `--write-cursor-rules` produced usable Cursor artifacts |

## Gap 1 — Multi-repo DX

**Symptom:** In a multi-root Cursor workspace (nocciolo + strumentario + …), both projects emit an MCP server named `hindsight`. Cursor surfaces one connection (e.g. `project-0-nocciolo-hindsight`) pinned to `/mcp/nocciolo/`. Agents cannot reliably recall the Strumentario bank from the same session even though `.cursor/mcp.json` in strumentario is correct.

**Related friction:**

- `NOCCIOLO_HINDSIGHT_API_KEY` must be visible to the **Cursor process**, not only a terminal shell; missing/empty env → MCP `401 Invalid API key`
- Printed/written MCP configs default to a generic server key `hindsight`, which collides across repos
- `docker.containerName` is project-local config but often names a **machine-shared** server — easy to confuse with bank id (we already document “shared server, many banks,” but MCP naming still implies 1:1)
- Interrupted sync seed (Ctrl+C) leaves a partial bank and no/incomplete local manifest; recovery is “re-run with `--force`” but easy to miss mid-run

**Product implications:**

1. Default MCP server name should be bank-scoped (e.g. `hindsight-<bankId>`) so multi-root workspaces can attach multiple banks
2. Optional `--server-name` on `mcp` for overrides
3. Document Cursor env inheritance for tenant keys; consider a `nocciolo mcp --check` / health hint that probes MCP with resolved auth (without printing secrets)
4. Clearer post-interrupt seed messaging and/or resume story (Phase 6 reliability overlap)

## Gap 2 — Bank template apply

**Symptom:** `configure` only writes a JSON file. Applying mission, directives, and mental models still requires a manual Control Plane import (or ad-hoc API). The happy path docs say “import the template,” but there is no first-class CLI step.

**Why it matters for sharing:**

- Teams cannot reproduce an identical bank profile from config alone without a human UI step
- Shareable configs are incomplete if “create bank + apply template” is not automatable and idempotent
- Dogfooders who skip import seed into a bank with wrong/empty mission and directives

**Product implications:**

1. `nocciolo configure --apply` (or `nocciolo bank apply`) that POSTs the template to Hindsight with `--dry-run`
2. Idempotent create-or-update for bank + directives + mental models
3. Actionable errors when the bank is missing vs auth fails vs template version mismatch
4. Keep generation (`configure`) separate from apply (integration/provider concern) — do not collapse into seed

## Gap 3 — Shareable config shape

**Symptom:** Version-controlled `.nocciolo/config.json` mixes **portable** project identity (`bankId`, `provider`, `name`) with **machine/environment** defaults (`docker.containerName`, optional `hindsightBaseUrl` pointing at localhost). Committed `.cursor/mcp.json` hard-codes `http://localhost:8888/mcp/<bankId>/`, which is correct for local dogfood but not for LAN/VPN/public teammates.

**What a teammate actually needs:**

| Concern | Today | Needed for Phase 4 |
|---------|--------|---------------------|
| Which bank? | `bankId` in config | Stable, shareable bank identity |
| Where is the server? | localhost assumption / per-machine docker name | Deployment profile: local / LAN / VPN / public |
| How to auth? | Env var by convention | Documented secret channel per profile (never commit keys) |
| How do agents connect? | Per-repo MCP snippets with localhost URL | Profile-aware MCP emission (URL + server name + auth placeholders) |
| What is the bank’s mission? | Template file + manual import | Applied template as part of share/bootstrap |

**Product implications:**

1. Split or layer config: **project** (committed) vs **environment/profile** (local or generated)
2. Introduce an explicit share artifact (e.g. `.nocciolo/share.json` or profile under `.nocciolo/profiles/`) that names deployment mode + base URL strategy without secrets
3. `nocciolo mcp` / future `nocciolo share` should emit harness configs from the active profile, not only localhost defaults
4. Keep docker helper inputs as environment concern; do not force every clone to share the same container name

## Priority for Phase 4 implementation

Ordered by dogfood pain → sharing readiness:

1. **MCP multi-repo DX** — bank-scoped server names; document Cursor auth env; optional connectivity check
2. **Bank template apply** — CLI apply with dry-run; unblock reproducible bank bootstrap
3. **Shareable config + profiles** — project vs environment split; local/LAN/VPN/public self-host **and** [Hindsight Cloud](./hindsight-cloud.md) emitters
4. Deployment security defaults and `nocciolo share` validation (remaining Phase 4 checklist)

## Non-goals (still Phase 7+; mental-model lifecycle is Phase 5)

- Multi-provider backends
- Automatic multi-bank orchestration across orgs
- Replacing Hindsight Control Plane UI entirely

## Sign-off

Strumentario dogfood (seed + HTTP recall) completed. Gaps above captured into Phase 4 roadmap items. Next implementation slice should start with MCP naming / multi-repo DX unless sharing work unblocks on template apply first.
