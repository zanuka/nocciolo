# Nocciolo Roadmap

High-level phased plan. This is a living document — priorities will shift based on real usage and feedback as we build in public.

## Phase 0 — Foundation (Now)

- [x] Repository created
- [x] README + vision
- [x] Basic project structure and TypeScript CLI skeleton
- [x] MIT license, contributing guidelines, CODE_OF_CONDUCT
- [x] CLI installable on PATH / package publish-ready as `@nocciolo-ai/cli` (`publishConfig`, global link / install docs)
- [ ] First npm publish of `@nocciolo-ai/cli`
- [ ] GitHub project board / issue templates for public development

**Goal:** Clean starting point that makes the vision obvious and invites early feedback.

## Phase 1 — Core CLI + Hindsight Bank Config

- [x] `nocciolo init` — detect project root, scaffold `.nocciolo/` config (interactive bank id + Docker container name; flags/`--yes` for non-interactive)
- [x] Bank template generation for Hindsight (mission, directives, extraction settings)
- [x] Sensible defaults for typical full-stack / web projects
- [x] `nocciolo configure` — non-interactive bank setup with `--dry-run` (interactive prompts later)
- [x] Basic validation and dry-run support

**Goal:** A developer can point Nocciolo at a repo and get a ready-to-apply Hindsight bank template in under a minute.

## Phase 2 — Knowledge Curation & Seeding

- [x] Project scanner for durable sources (README, `/docs`, ADRs, AGENTS.md) — conservative first pass
- [x] Extraction heuristics that prefer decisions, invariants, and architecture over ephemeral content
- [x] `nocciolo seed --dry-run` — preview extracted candidates with provenance
- [x] `nocciolo seed` — retain high-signal knowledge into the configured Hindsight bank
- [x] Seed progress reporting — do-not-interrupt warning + `[i/N]` percent during sync retain; optional `--async` operation polling
- [x] Incremental / re-seed support (content-hash manifest under `.nocciolo/local/`)
- [x] Simple provenance tracking (source file + commit)

**Goal:** Agents start sessions with real project context instead of an empty bank.

## Phase 3 — Local Hosting & Agent Integration

- [x] Docker / local Hindsight helper (`nocciolo docker` or equivalent)
- [x] MCP endpoint generation for Cursor, Kiro, Claude Code, Roo, Codex, etc.
- [x] `nocciolo mcp` — emit ready-to-paste configs and rules
- [x] Optional updates to `AGENTS.md` / Cursor rules that tell agents to prefer the project bank
- [x] Single-bank focus (multi-bank later)

**Goal:** End-to-end path from repo → configured bank → agent that actually uses it.

## Phase 4 — Team Sharing & Deployment Profiles

**Dogfood target:** [Strumentario](https://github.com/zanuka/strumentario) — first external repo to run the full `init` → `configure` → `seed` → `mcp` path on a shared local Hindsight server (same Docker container as the nocciolo bank, distinct `bankId`). Lessons from this pass drive shareable configs and deployment profiles.

- [x] Dogfood: create and seed a Hindsight bank for Strumentario via the Nocciolo CLI (shared container, bank id `strumentario`)
- [x] Capture dogfood gaps (multi-repo DX, bank template apply, shareable config shape) back into this phase — see [docs/phase-4-dogfood-gaps.md](./docs/phase-4-dogfood-gaps.md)
- [ ] Multi-repo MCP DX — bank-scoped MCP server names (e.g. `hindsight-<bankId>`), optional `--server-name`, Cursor auth/env guidance (and optional MCP connectivity check)
- [ ] Bank template apply — `configure --apply` or `bank apply` to create/update the Hindsight bank from `.nocciolo/hindsight/bank-template.json` (`--dry-run`)
- [ ] Shareable knowledgebase configs — split portable project identity from environment/profile (base URL strategy, no secrets in git)
- [ ] Deployment profile: **local / LAN** — single machine or trusted network, minimal exposure
- [ ] Deployment profile: **VPN** — bank reachable only inside a private network for closed teams
- [ ] Deployment profile: **public** — intentionally exposed hosting when knowledge is meant to be open
- [ ] Documented security defaults and trade-offs per profile (auth, TLS, network binding)
- [ ] CLI helpers to generate and validate the chosen profile (`nocciolo share` or equivalent, with `--dry-run`)
- [ ] Profile-aware MCP / harness emission (URLs and server names follow the active deployment profile)

**Goal:** A team can publish one durable bank and let agents across the org inherit it — without forcing a single cloud path.

## Phase 5 — Reliability & Developer Experience

- [ ] Status / health commands
- [ ] Better error messages and recovery paths
- [ ] Bank rename / re-id — when the repo (or desired bank id) changes, keep the same retained knowledge under the new name; update `.nocciolo/` config, bank template, seed manifest, and MCP/agent wiring (`--dry-run`). Do not require a full re-seed into an empty bank
- [ ] Config schema + validation
- [ ] Test coverage for core extraction and template logic
- [ ] Documentation site or expanded examples

**Goal:** The tool feels solid enough for daily use on real projects.

## Phase 6 — Advanced & Extensibility

- [ ] File watcher / event-driven re-seeding
- [ ] Multi-provider support (Hindsight first, then others)
- [ ] Multi-bank and multi-repo company brains
- [ ] Mental model curation helpers
- [ ] Lightweight inspection UI (optional, later)
- [ ] Deeper ADR and decision-record parsers

**Goal:** Nocciolo becomes the durable knowledge layer that agentic workflows can reliably build on.

---

### Guiding Constraints

- Prefer local control and self-hosting
- Team sharing must remain opt-in and profile-driven (local/LAN, VPN, public) — never a forced cloud default
- Amplify existing engineering practices (ADRs, standards, clear architecture) rather than replace them
- Keep the CLI fast and the happy path short
- Stay focused on knowledgebases and agent context before expanding into broader agent orchestration

Feedback and real-world usage will reshape this plan. Open issues or discussions are the best way to influence direction.
