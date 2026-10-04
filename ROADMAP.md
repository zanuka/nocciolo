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

- [x] Project scanner for durable sources (README, `/docs`, ADRs): conservative first pass; `AGENTS.md` is integration surface, not seed input
- [x] Optional `scanner.include` / `exclude` / `extensions` in `.nocciolo/config.json` (MDX when listed; secrets denylist still wins; `store.allowlist` stays orthogonal)
- [x] Extraction heuristics that prefer decisions, invariants, and architecture over ephemeral content (YAML frontmatter stripped before section scoring)
- [x] `nocciolo seed --dry-run`: preview extracted candidates with provenance
- [x] `nocciolo seed`: retain high-signal knowledge into the configured Hindsight bank
- [x] Seed progress reporting: do-not-interrupt warning + `[i/N]` percent during sync retain; optional `--async` operation polling
- [x] Incremental / re-seed support (content-hash manifest under `.nocciolo/local/`)
- [x] Simple provenance tracking (source file + commit)

**Goal:** Agents start sessions with real project context instead of an empty bank.

## Phase 3: Local Hosting & Agent Integration

- [x] Docker / local Hindsight helper (`nocciolo docker` or equivalent)
- [x] `nocciolo docker upgrade --to <version>`: backup all banks, recreate on same volume with preserved env, validate fact counts (pinned tags only)
- [x] MCP endpoint generation for Cursor, Kiro, Claude Code, Roo, Codex, etc.
- [x] `nocciolo mcp`: emit ready-to-paste configs and rules
- [x] Optional updates to `AGENTS.md` / Cursor rules that tell agents to prefer the project bank
- [x] Single-bank focus (multi-bank later)
- [x] `nocciolo store`: operator-selected, ongoing incremental retain once durable project `.md` already exists on disk (preview first; reuses `seed`'s retain path exactly, no second implementation)
- [x] Firstmate dogfood: on-demand `project-bank` skill (`nocciolo mcp --harness firstmate --write-firstmate`) appends a recall-only bank card to the ship brief before a crewmate spawn; crewmates recall, they never seed or store

**Goal:** End-to-end path from repo → configured bank → agent that actually uses it.

## Phase 4: Optional Jev judgment layer

[Jev](https://docs.typesafe.ai/introduction) (TypeSafe System One) is an opt-in judge for bounded decisions: what to retain, what is stale, what to seed first, and when a human should confirm.
Hindsight stays the memory backend and the CLI provider.
With no `NOCCIOLO_TYPESAFE_API_KEY` and no `--judge jev`, the CLI keeps today's offline heuristics.
Nocciolo owns scanning, side effects, and apply.
Jev returns typed choices and scores.
Low confidence queues a dry-run or a confirmation.
Secrets and denylisted paths stay on the machine.

`nocciolo prune` v1 (path-gone / section-gone / explicit delete + local tombstones) shipped without Jev.
See [CLI reference](./docs/nocciolo-cli-commands.md#nocciolo-prune).
Optional `--judge jev` annotation on prune remains in this phase.

Tracked in [JEV-0](https://github.com/zanuka/nocciolo/issues/58) and the [open `jev` issues](https://github.com/zanuka/nocciolo/issues?q=is%3Aissue+is%3Aopen+label%3Ajev).
The checklist groups those tickets.
Individual issues stay on GitHub.

- [ ] Product rule and judge port: `docs/jev.md`, a `Judge` interface (`off` / `heuristic` / `jev`), `--judge` and `--confidence`, and state sanitization (secrets, denylist, size). A missing key or API failure falls back to heuristics. The default path makes no TypeSafe calls. (JEV-1, JEV-2, JEV-3)
- [ ] Seed keep/skip: section-level relevance, knowledge-kind, contradiction against existing observations, citation support, and a PII or secret second pass. `seed --dry-run --judge jev` shows keep/skip plus scores. (JEV-4 through JEV-9)
- [ ] Store and retain budget: propose allowlist adoption for new durable files, rank candidates under a retain budget, and gate `store` edits on durability. The operator still confirms. (JEV-10, JEV-11, JEV-12)
- [x] `nocciolo prune` (v1): path-gone / section-gone / explicit `--source` or `--document-id`, `--dry-run`, TTY multi-select, non-interactive `--yes` with explicit selection, Hindsight document delete, local `.nocciolo/local/tombstones.json` so unchanged sources are not re-retained on the next `seed` / `store` (`--force` or content change can retain again). Mental-model refresh is recommended in copy only.
- [ ] Optional `--judge jev` prune annotation: score items that are still on disk but no longer true (outdated / irrelevant / contradicted). Jev annotates only; Nocciolo deletes after confirm. Low confidence is listed and left unchecked. (JEV-14 through JEV-17, JEV-35)
- [ ] Bank-template fitness: score mission and directives, choose extraction aggressiveness from repo shape, propose mental-model catalog questions, and assign tags consistently. Jev does not author the prose. (JEV-18 through JEV-21)
- [ ] Recall and MCP guards: block unsafe MCP `retain`, rerank recalled passages, check whether a memory is still true, and route `reflect` vs `recall` vs mental-model lookup. (JEV-22 through JEV-25)
- [ ] Firstmate routing: whether a task needs the project bank, which bank, knowledge update vs PR vs both, escalate vs dispatch, and whether a scout report is seedable. Low confidence escalates to the captain. (JEV-26 through JEV-30)
- [ ] Share safety and destination kind: route by destination kind (Hindsight remains first-class) and gate a public or Cloud share on a safety check before anything is exposed. (JEV-31, JEV-33)
- [ ] Heuristic eval: a golden-set judge that scores the offline heuristics so the default path improves without requiring Jev at runtime. (JEV-34)

Deferred: the watcher high-signal gate (JEV-13) lands with event-driven re-seed, multi-bank fact routing (JEV-32) lands with multi-bank support, and the Maglio and Strumentario product judges (JEV-36, JEV-37) stay adjacent dogfood.

**Goal:** An operator can preview keep/skip scores with `seed --dry-run --judge jev`, and every retain, prune, and share still happens only in Nocciolo, behind a confidence gate.

## Phase 5: Team Sharing & Deployment Profiles

**Dogfood targets:**

- [Strumentario](https://github.com/zanuka/strumentario): first external repo to run the full `init` → `configure` → `seed` → `mcp` path on a shared local Hindsight server (same Docker container as the nocciolo bank, distinct `bankId`). Lessons from this pass drive shareable configs and deployment profiles.

- [x] Dogfood: create and seed a Hindsight bank for Strumentario via the Nocciolo CLI (shared container, bank id `strumentario`)
- [x] Capture dogfood gaps (multi-repo DX, bank template apply, shareable config shape) back into this phase: see [docs/phase-4-dogfood-gaps.md](./docs/phase-4-dogfood-gaps.md)
- [x] Dogfood: zanuka-web day-to-day ops document `nocciolo store` (allowlist-gated); no zanuka-web patch attempted
- [x] Capture zanuka-web gaps (prune / list-bank-docs / delete-doc parity; deferred Firstmate `project-bank`) : see [docs/phase-5-dogfood-gaps.md](./docs/phase-5-dogfood-gaps.md)
- [x] Bank document ops parity: thin `nocciolo docs list` inventory helper (JSON optional); delete stays on `prune --document-id --yes`; dogfood archive of Python list/delete helpers after zanuka-web prune pass
- [x] Multi-repo MCP DX: bank-scoped MCP server names (`hindsight-<bankId>`), optional `--server-name`, Cursor auth/env guidance, optional `mcp --check`
- [x] Bank template apply: `configure --apply` and `bank apply` create/update the Hindsight bank from `.nocciolo/hindsight/bank-template.json` (`--dry-run`)
- [x] Shareable knowledgebase configs: portable project identity in `config.json` plus `.nocciolo/share.json` deployment profile (base URL strategy, no secrets in git)
- [x] Deployment profile: **local / LAN**: single machine or trusted network, minimal exposure
- [x] Deployment profile: **VPN**: bank reachable only inside a private network for closed teams
- [x] Deployment profile: **public**: intentionally exposed self-hosted Hindsight when knowledge is meant to be open
- [x] Deployment profile: **hindsight-cloud**: managed [Hindsight Cloud](https://docs.hindsight.vectorize.io/) (`https://api.hindsight.vectorize.io`); API key for seed/apply; bank-scoped MCP and/or OAuth MCP; skip local Docker: see [docs/hindsight-cloud.md](./docs/hindsight-cloud.md)
- [x] Documented security defaults and trade-offs per profile (auth, TLS, network binding, Cloud credits / data residency)
- [x] CLI helpers to generate and validate the chosen profile (`nocciolo share`, with `--dry-run` / `--validate`)
- [x] Profile-aware MCP / harness emission (URLs and server names follow the active deployment profile; Cloud emits `api.hindsight.vectorize.io` + env key placeholders)

**Goal:** A team can publish one durable bank and let agents across the org inherit it: local/self-host by default, [Hindsight Cloud](https://docs.hindsight.vectorize.io/) opt-in, never a forced cloud path.

User guide: [docs/team-sharing.md](./docs/team-sharing.md).

## Phase 6: Mental Models (Hindsight-native curated reflect)

[Hindsight mental models](https://hindsight.vectorize.io/developer/api/mental-models) are **saved reflect responses** checked first during reflect (before observations and raw facts). They are not the same as Mem0’s “mental model” metaphor in [How Mem0 Works](https://docs.mem0.ai/core-concepts/how-it-works): Mem0 stores extracted facts and retrieves them via `search`; it has no first-class curated-summary layer. Closest Mem0 knobs are **custom instructions** / **custom categories** (write-time extraction and labeling), which map more to Nocciolo’s retain mission and tags than to Hindsight mental models.

**Approach (hybrid: not init-only, not docs-only):**

| Layer | What ships | Why |
|-------|------------|-----|
| Defaults in bank template | Already generated in Phase 1 (`project-context`, `architecture-decisions`, `coding-standards`) | Sensible starter pack; applied with Phase 5 `configure --apply` / `bank apply` |
| Post-seed lifecycle CLI | Create / list / refresh / clear with `--dry-run`; stable custom IDs | Models are useless until the bank has retained knowledge; refresh is the real product |
| Version-controlled declarations | Extend `.nocciolo/hindsight/bank-template.json` (or a sibling mental-models section) for project-specific queries, tags, and triggers | Durable, shareable, reviewable: same as mission/directives |
| Best-practice guidance | When to use auto-refresh vs manual; tag/`tags_match` pitfalls; agent “prefer reflect for playbook questions” | Prevent empty refreshes and over-eager regeneration of curated policy docs |

Do **not** fold mental-model curation into `init` prompts. Keep generation in `configure` / template; keep apply separate; add refresh after `seed`. Multi-provider: treat mental models as a **Hindsight adapter** capability; Mem0 path later can expose extraction instructions + category/metadata guidance without inventing a fake mental-model API.

- [x] Document mental-model role, tagging, configure wizard, and post-seed CLI: see [docs/hindsight-mental-models.md](./docs/hindsight-mental-models.md)
- [ ] Fix default template refresh safety: tagged models default to `all_strict` source matching; align seed tags **or** set `trigger.tags_match` (e.g. `any`) so first refresh is not empty
- [ ] Interactive `configure` wizard (TTY) for starter models, tagging mode, and refresh policy; `--yes` / flags for non-interactive
- [ ] `nocciolo mental-model`: list / create / update / refresh / clear / tags against the configured bank (`--dry-run`; poll async operations like seed)
- [ ] Idempotent apply of declared models from the bank template (stable `id`s; create-or-update; complements Phase 5 bank apply)
- [ ] Optional post-seed hook: refresh declared models after retain + consolidation (opt-in flag, not default magic)
- [ ] Refresh policy presets in template: auto after consolidation for evolving summaries; manual / no auto for curated policy FAQs; optional `delta` mode for long playbooks
- [ ] Agent integration hint: MCP / AGENTS snippet that agents should `reflect` (or read mental models) for architecture / standards / “how we work” questions, not only `recall`
- [ ] Provider boundary: Hindsight mental-model module; portable “curated context pack” shape only if a future Mem0 (or other) path has a real counterpart

**Goal:** After seed, agents get consistent, high-priority answers to the project’s recurring questions: not just a bag of retained facts.

## Phase 7: Reliability & Developer Experience

- [ ] Status / health commands
- [ ] Better error messages and recovery paths
- [ ] Bank rename / re-id: when the repo (or desired bank id) changes, keep the same retained knowledge under the new name; update `.nocciolo/` config, bank template, seed manifest, and MCP/agent wiring (`--dry-run`). Do not require a full re-seed into an empty bank
- [ ] Config schema + validation
- [ ] Test coverage for core extraction and template logic
- [ ] Documentation site or expanded examples

**Goal:** The tool feels solid enough for daily use on real projects.

## Phase 8: Advanced & Extensibility

- [ ] File watcher / event-driven re-seeding
- [ ] Multi-provider support: Hindsight remains first-class and the default; other backends are opt-in CLI options
  - [ ] Multi-provider foundation (extract `HindsightProvider`, `--provider` dispatch)
  - [ ] Mem0 adapter
  - [ ] Graphiti / Zep adapter: **seed destination only** (see [docs/graphiti-integration.md](./docs/graphiti-integration.md))
    - [ ] OSS HTTP transport spike (`add_episode` + `group_id`)
    - [ ] `init` / `configure` / `seed --dry-run` / incremental `seed`
    - [ ] Software ontology (`software-v1`) + extraction instructions
    - [ ] Optional Zep Cloud runtime (`--provider zep`)
    - [ ] `mcp` / `docker print` point at official Graphiti docs (do not vendor compose)
  - [ ] Cognee adapter (later)
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
