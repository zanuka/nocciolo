# Nocciolo Roadmap

High-level phased plan. This is a living document; priorities will shift based on real usage and feedback as we build in public.

## Phase 0: Foundation (Now)

- [x] Repository created
- [x] README + vision
- [x] Basic project structure and TypeScript CLI skeleton
- [x] MIT license, contributing guidelines, CODE_OF_CONDUCT
- [x] CLI installable on PATH / package publish-ready as `@nocciolo-ai/cli` (`publishConfig`, global link / install docs)
- [ ] First npm publish of `@nocciolo-ai/cli`
- [ ] GitHub project board / issue templates for public development

**Goal:** Clean starting point that makes the vision obvious and invites early feedback.

## Phase 1: Core CLI + Hindsight Bank Config

- [x] `nocciolo init`: detect project root, scaffold `.nocciolo/` config (interactive bank id + Docker container name; flags/`--yes` for non-interactive)
- [x] Bank template generation for Hindsight (mission, directives, extraction settings)
- [x] Sensible defaults for typical full-stack / web projects
- [x] `nocciolo configure`: non-interactive bank setup with `--dry-run` (interactive prompts later)
- [x] Basic validation and dry-run support

**Goal:** A developer can point Nocciolo at a repo and get a ready-to-apply Hindsight bank template in under a minute.

## Phase 2: Knowledge Curation & Seeding

- [x] Project scanner for durable sources (README, `/docs`, ADRs, AGENTS.md): conservative first pass
- [x] Extraction heuristics that prefer decisions, invariants, and architecture over ephemeral content
- [x] `nocciolo seed --dry-run`: preview extracted candidates with provenance
- [x] `nocciolo seed`: retain high-signal knowledge into the configured Hindsight bank
- [x] Seed progress reporting: do-not-interrupt warning + `[i/N]` percent during sync retain; optional `--async` operation polling
- [x] Incremental / re-seed support (content-hash manifest under `.nocciolo/local/`)
- [x] Simple provenance tracking (source file + commit)

**Goal:** Agents start sessions with real project context instead of an empty bank.

## Phase 3: Local Hosting & Agent Integration

- [x] Docker / local Hindsight helper (`nocciolo docker` or equivalent)
- [x] MCP endpoint generation for Cursor, Kiro, Claude Code, Roo, Codex, etc.
- [x] `nocciolo mcp`: emit ready-to-paste configs and rules
- [x] Optional updates to `AGENTS.md` / Cursor rules that tell agents to prefer the project bank
- [x] Single-bank focus (multi-bank later)

**Goal:** End-to-end path from repo → configured bank → agent that actually uses it.

## Phase 4: Team Sharing & Deployment Profiles

**Dogfood target:** [Strumentario](https://github.com/zanuka/strumentario): first external repo to run the full `init` → `configure` → `seed` → `mcp` path on a shared local Hindsight server (same Docker container as the nocciolo bank, distinct `bankId`). Lessons from this pass drive shareable configs and deployment profiles.

- [x] Dogfood: create and seed a Hindsight bank for Strumentario via the Nocciolo CLI (shared container, bank id `strumentario`)
- [x] Capture dogfood gaps (multi-repo DX, bank template apply, shareable config shape) back into this phase: see [docs/phase-4-dogfood-gaps.md](./docs/phase-4-dogfood-gaps.md)
- [ ] Multi-repo MCP DX: bank-scoped MCP server names (e.g. `hindsight-<bankId>`), optional `--server-name`, Cursor auth/env guidance (and optional MCP connectivity check)
- [ ] Bank template apply: `configure --apply` or `bank apply` to create/update the Hindsight bank from `.nocciolo/hindsight/bank-template.json` (`--dry-run`)
- [ ] Shareable knowledgebase configs: split portable project identity from environment/profile (base URL strategy, no secrets in git)
- [ ] Deployment profile: **local / LAN**: single machine or trusted network, minimal exposure
- [ ] Deployment profile: **VPN**: bank reachable only inside a private network for closed teams
- [ ] Deployment profile: **public**: intentionally exposed self-hosted Hindsight when knowledge is meant to be open
- [ ] Deployment profile: **hindsight-cloud**: managed [Hindsight Cloud](https://docs.hindsight.vectorize.io/) (`https://api.hindsight.vectorize.io`); API key for seed/apply; bank-scoped MCP and/or OAuth MCP; skip local Docker: see [docs/hindsight-cloud.md](./docs/hindsight-cloud.md)
- [ ] Documented security defaults and trade-offs per profile (auth, TLS, network binding, Cloud credits / data residency)
- [ ] CLI helpers to generate and validate the chosen profile (`nocciolo share` or equivalent, with `--dry-run`)
- [ ] Profile-aware MCP / harness emission (URLs and server names follow the active deployment profile; Cloud emits `api.hindsight.vectorize.io` + env key placeholders)

**Goal:** A team can publish one durable bank and let agents across the org inherit it: local/self-host by default, [Hindsight Cloud](https://docs.hindsight.vectorize.io/) opt-in, never a forced cloud path.

## Phase 5: Mental Models (Hindsight-native curated reflect)

[Hindsight mental models](https://hindsight.vectorize.io/developer/api/mental-models) are **saved reflect responses** checked first during reflect (before observations and raw facts). They are not the same as Mem0’s “mental model” metaphor in [How Mem0 Works](https://docs.mem0.ai/core-concepts/how-it-works): Mem0 stores extracted facts and retrieves them via `search`; it has no first-class curated-summary layer. Closest Mem0 knobs are **custom instructions** / **custom categories** (write-time extraction and labeling), which map more to Nocciolo’s retain mission and tags than to Hindsight mental models.

**Approach (hybrid: not init-only, not docs-only):**

| Layer | What ships | Why |
|-------|------------|-----|
| Defaults in bank template | Already generated in Phase 1 (`project-context`, `architecture-decisions`, `coding-standards`) | Sensible starter pack; applied with Phase 4 `configure --apply` / `bank apply` |
| Post-seed lifecycle CLI | Create / list / refresh / clear with `--dry-run`; stable custom IDs | Models are useless until the bank has retained knowledge; refresh is the real product |
| Version-controlled declarations | Extend `.nocciolo/hindsight/bank-template.json` (or a sibling mental-models section) for project-specific queries, tags, and triggers | Durable, shareable, reviewable: same as mission/directives |
| Best-practice guidance | When to use auto-refresh vs manual; tag/`tags_match` pitfalls; agent “prefer reflect for playbook questions” | Prevent empty refreshes and over-eager regeneration of curated policy docs |

Do **not** fold mental-model curation into `init` prompts. Keep generation in `configure` / template; keep apply separate; add refresh after `seed`. Multi-provider: treat mental models as a **Hindsight adapter** capability; Mem0 path later can expose extraction instructions + category/metadata guidance without inventing a fake mental-model API.

- [x] Document mental-model role, tagging, configure wizard, and post-seed CLI: see [docs/hindsight-mental-models.md](./docs/hindsight-mental-models.md)
- [ ] Fix default template refresh safety: tagged models default to `all_strict` source matching; align seed tags **or** set `trigger.tags_match` (e.g. `any`) so first refresh is not empty
- [ ] Interactive `configure` wizard (TTY) for starter models, tagging mode, and refresh policy; `--yes` / flags for non-interactive
- [ ] `nocciolo mental-model`: list / create / update / refresh / clear / tags against the configured bank (`--dry-run`; poll async operations like seed)
- [ ] Idempotent apply of declared models from the bank template (stable `id`s; create-or-update; complements Phase 4 bank apply)
- [ ] Optional post-seed hook: refresh declared models after retain + consolidation (opt-in flag, not default magic)
- [ ] Refresh policy presets in template: auto after consolidation for evolving summaries; manual / no auto for curated policy FAQs; optional `delta` mode for long playbooks
- [ ] Agent integration hint: MCP / AGENTS snippet that agents should `reflect` (or read mental models) for architecture / standards / “how we work” questions, not only `recall`
- [ ] Provider boundary: Hindsight mental-model module; portable “curated context pack” shape only if a future Mem0 (or other) path has a real counterpart

**Goal:** After seed, agents get consistent, high-priority answers to the project’s recurring questions: not just a bag of retained facts.

## Phase 6: Reliability & Developer Experience

- [ ] Status / health commands
- [ ] Better error messages and recovery paths
- [ ] Bank rename / re-id: when the repo (or desired bank id) changes, keep the same retained knowledge under the new name; update `.nocciolo/` config, bank template, seed manifest, and MCP/agent wiring (`--dry-run`). Do not require a full re-seed into an empty bank
- [ ] Config schema + validation
- [ ] Test coverage for core extraction and template logic
- [ ] Documentation site or expanded examples

**Goal:** The tool feels solid enough for daily use on real projects.

## Phase 7: Advanced & Extensibility

- [ ] File watcher / event-driven re-seeding
- [ ] Multi-provider support: **optional / demand-driven**; Hindsight remains first-class. Do not schedule Mem0, Graphiti, Cognee, or others until the Hindsight path is strong and users ask for another backend
- [ ] Multi-bank and multi-repo company brains
- [ ] Lightweight inspection UI (optional, later)
- [ ] Deeper ADR and decision-record parsers

**Goal:** Nocciolo becomes the durable knowledge layer that agentic workflows can reliably build on.

---

### Guiding Constraints

- Prefer local control and self-hosting as the default; [Hindsight Cloud](https://docs.hindsight.vectorize.io/) is an explicit opt-in profile
- Hindsight-native first; other memory providers only if demanded and without compromising the Hindsight experience
- Team sharing must remain opt-in and profile-driven (local/LAN, VPN, public self-host, or Hindsight Cloud): never a forced cloud default
- Amplify existing engineering practices (ADRs, standards, clear architecture) rather than replace them
- Keep the CLI fast and the happy path short
- Stay focused on knowledgebases and agent context before expanding into broader agent orchestration

Feedback and real-world usage will reshape this plan. Open issues or discussions are the best way to influence direction.
