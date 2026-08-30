# Graphiti / Zep provider

How to implement Graphiti (and optional Zep Cloud) as a **CLI option** in Nocciolo — not as a second default, and not as a Graphiti installer.

**Status:** Ready to implement after the provider interface lands (`MULTI_PROVIDER_PLAN.md` Phase A).  
**Depends on:** `HindsightProvider` extracted behind `MemoryProvider`.  
**Related:** `GRAPHITI_ZEP_PLAN.md` (strategy + go/no-go), `MULTI_PROVIDER_PLAN.md`, `ROADMAP.md` Phase 6.

Drop this file into the Nocciolo repo as `docs/graphiti.md`. Paste the [roadmap snippet](#roadmap-snippet) into `ROADMAP.md`.

---

## 1. Product rule

Nocciolo’s job does not change: scan the repo, curate durable knowledge, seed a memory backend, emit enough harness config that agents use it.

Graphiti already has a simple path to **stand up a graph and wire Cursor** (`docker compose` in `graphiti/mcp_server` + `http://localhost:8000/mcp/`). Nocciolo must not wrap that.

What Graphiti does not have — and why this provider exists — is a **project-native seeder**:

- scan README / ADRs / `docs/` / `AGENTS.md`
- skip secrets and low-signal noise
- install a software ontology instead of Preference / Person / Object
- incremental re-seed when those files change
- keep that config in `.nocciolo/` next to the repo

| Build | Do not build |
|-------|----------------|
| `GraphitiProvider` on the shared `MemoryProvider` interface | A Graphiti fork, Python embed, or unofficial TS port |
| `init` / `configure` / `seed` for `provider: graphiti` | Replacing official Docker Compose or MCP server |
| Ontology + extraction instructions for engineering docs | Making Graphiti the CLI default |
| Incremental episode append with git `reference_time` | `clear_graph` on every seed |
| Thin `mcp` / `docker print` that **points at official URLs** | `docker up` automation that clones `getzep/graphiti` |
| Optional Zep Cloud transport behind the same provider | Wrapping deprecated Zep Community Edition |

Hindsight stays the default. `--provider graphiti` is opt-in. `--provider zep` is an alias for Graphiti + Cloud runtime.

---

## 2. User-visible CLI

Same verbs as Hindsight. Provider is selected by flag or by `.nocciolo/config.json`.

```bash
# Choose Graphiti at init (prompts runtime: oss | cloud)
pnpm nocciolo init --provider graphiti
pnpm nocciolo init --provider zep          # alias → graphiti + runtime cloud

# Or switch later
pnpm nocciolo configure --provider graphiti

pnpm nocciolo seed --provider graphiti --dry-run
pnpm nocciolo seed --provider graphiti
pnpm nocciolo seed --provider graphiti --force          # re-emit all current candidates as new episodes
pnpm nocciolo seed --provider graphiti --reset-graph    # explicit wipe; confirm required

pnpm nocciolo mcp --provider graphiti                   # print official MCP URL + group_id notes
pnpm nocciolo docker print --provider graphiti          # print official compose commands; do not execute
```

If `config.provider` is already `graphiti`, the flag is optional.

`init` prompts (non-interactive flags in parentheses):

1. Runtime — `oss` (default) or `cloud` (`--runtime`)
2. Bank / group / graph id — default `nocciolo-{slug}` (`--bank-id`)
3. OSS only — Graphiti base URL default `http://localhost:8000` (`--graphiti-url`)
4. Cloud only — confirm env name `ZEP_API_KEY` (never store the key)

Do not prompt for Neo4j vs FalkorDB in v1. OSS docs assume the official FalkorDB+MCP combined compose. Mention Neo4j as a footnote.

### Environment

| Variable | Used by | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | Graphiti OSS server (their process) | LLM extraction inside Graphiti. Nocciolo does not send this to Graphiti unless we later call a self-hosted API that requires it. |
| `NOCCIOLO_GRAPHITI_URL` | Nocciolo CLI | OSS HTTP base (`http://localhost:8000`) |
| `ZEP_API_KEY` | Nocciolo CLI | Zep Cloud SDK |
| `NOCCIOLO_GRAPHITI_GROUP_ID` | optional override | `group_id` / `graph_id` if not using `bankId` |

Secrets stay in the environment. `.nocciolo/config.json` stores env *names*, not values.

---

## 3. Config shape

Extend `.nocciolo/config.json`. Keep provider-specific blocks side by side so a repo can switch later without rewriting bank id.

```json
{
  "provider": "graphiti",
  "bankId": "my-project",
  "graphiti": {
    "runtime": "oss",
    "baseUrl": "http://localhost:8000",
    "groupId": "nocciolo-my-project",
    "apiKeyEnv": "ZEP_API_KEY",
    "ontology": "software-v1"
  }
}
```

Cloud:

```json
{
  "provider": "graphiti",
  "bankId": "my-project",
  "graphiti": {
    "runtime": "cloud",
    "graphId": "nocciolo-my-project",
    "apiKeyEnv": "ZEP_API_KEY",
    "ontology": "software-v1"
  }
}
```

`groupId` (OSS) and `graphId` (Cloud) should default to `nocciolo-{bankId}`. Do not use Zep `user_id`. Nocciolo seeds a **shared project graph**, not a per-developer memory.

Write generated artifacts under `.nocciolo/` so they travel with the repo:

```
.nocciolo/
  config.json
  graphiti/
    ontology.json              # entity / edge types shipped with configure
    extraction-instructions.md # derived from mission / directives
  local/
    seed-manifest.json         # existing incremental manifest, provider-aware records
```

---

## 4. Code layout

Implement against the interface in `MULTI_PROVIDER_PLAN.md`. Suggested modules (names can match existing CLI packages):

```
src/providers/
  types.ts                 # MemoryProvider, SeedCandidate, SeedResult
  hindsight.ts             # existing behavior, extracted
  graphiti/
    index.ts               # GraphitiProvider
    oss-transport.ts       # HTTP to Graphiti FastAPI / episode API
    cloud-transport.ts     # @getzep/zep-cloud
    map-episode.ts         # SeedCandidate → episode payload
    ontology.ts            # software-v1 types
    manifest.ts            # episode uuid + hash records
```

CLI commands stay thin: load config → `getProvider(config)` → `provider.configure()` / `provider.seed()`.

```ts
interface GraphitiTransport {
  addEpisode(episode: MappedEpisode): Promise<{ uuid: string }>;
  setOntology?(ontology: SoftwareOntology): Promise<void>;
  health(): Promise<void>;
  resetGraph?(): Promise<void>;
}
```

OSS transport talks HTTP only. Cloud transport uses `@getzep/zep-cloud`. Never shell out to Python, never depend on `graphzep` or other unofficial ports.

### Transport spike (do this first)

Before wiring the CLI, confirm one ADR-sized payload against a running official stack:

1. Official `graphiti/mcp_server` compose is up.
2. POST one `add_episode` (or FastAPI equivalent) with `group_id`, `name`, `episode_body`, `source`, `source_description`, `reference_time`.
3. Search and see the decision come back.

If FastAPI cannot take custom entity types, fall back to:

- MCP HTTP `add_episode` for seed (last resort), **or**
- text-only episodes in v1 and apply ontology only on Cloud via `graph.set_ontology`.

Freeze the transport in a short comment at the top of `oss-transport.ts`. Do not support both “just in case.”

---

## 5. Concept mapping

| Nocciolo | Graphiti OSS | Zep Cloud |
|----------|--------------|-----------|
| `bankId` | `group_id` | `graph_id` |
| Mission / directives | `custom_extraction_instructions` + ontology | `graph.set_ontology` + same instructions where the API allows |
| `seed` candidate | `add_episode` | `client.graph.add({ graph_id, type, data, created_at, source_description })` |
| Candidate `id` | Episode `name` | Episode name / source metadata |
| Git commit time | `reference_time` | `created_at` |
| README section | `EpisodeType.text` | `type: "text"` |
| Parseable ADR | `EpisodeType.json` | `type: "json"` |
| Re-seed | New episode, later `reference_time` | New `graph.add` |
| Wipe | `--reset-graph` only | equivalent Cloud clear / recreate graph |

### Re-seed rules

Graphiti is temporal-append, not Hindsight upsert.

1. Hash each candidate as today (`seed-manifest.json`).
2. Unchanged hash → skip.
3. Changed or new → **append** a new episode. Prefer name `{candidate.id}` on first insert and `{candidate.id}@{shortHash}` on updates so dry-run lines stay readable.
4. Store `{ candidateId, contentHash, episodeUuid, referenceTime }` in the manifest.
5. Set `reference_time` / `created_at` from the source file’s git author date when available; otherwise `now`.
6. Sort outgoing episodes oldest `reference_time` first so supersession works.
7. `--force` re-emits every current candidate as a new episode (history kept).
8. `--reset-graph` is the only wipe. Require `--yes` or an interactive confirm. Never imply wipe from a normal seed.

---

## 6. Episode shaping

Reuse the existing scanner. Do not add a Graphiti-specific crawler.

| Source | Type | Body | Time |
|--------|------|------|------|
| README / docs section | `text` | Section markdown, already trimmed by the scanner | file git date |
| ADR with parseable fields (`title`, `status`, `date`, `context`, `decision`, `consequences`) | `json` | those fields + `source` | ADR date, else git date |
| ADR that will not parse | `text` | section body | git date |
| `AGENTS.md` / standards | `text` | section | git date |
| Secrets / denylist / low score | skip | — | — |

JSON ADRs can wait until the text path works. Ship text-only in the first vertical slice if parsing is not already in the scanner.

`source_description` format:

```
nocciolo:{relative/path}#{section} commit={sha}
```

Keep dry-run output in the same shape as Hindsight:

```
[12/28] nocciolo:docs/adr/0003-auth.md#decision  text  2025-11-02  score=0.91
```

Print a do-not-interrupt banner. Each episode is an LLM extraction inside Graphiti; first seed takes minutes. Auth / connectivity failures abort before the loop.

---

## 7. Software ontology (`software-v1`)

Default Graphiti MCP types are assistant-oriented. `configure` must install Nocciolo types or extraction will produce Person / Preference noise.

### Entities

| Type | Capture |
|------|---------|
| `Decision` | A choice with rationale and date |
| `Adr` | A numbered architecture decision record |
| `Service` | Deployable / bounded context |
| `Module` | Package or library in the repo |
| `Interface` | Public API, event, or schema |
| `Constraint` | Invariant or non-negotiable |
| `Standard` | Coding, review, or security standard |
| `Team` | Owning group |
| `Dependency` | External system or library that shapes design |

### Edges

| Edge | From → To |
|------|-----------|
| `SUPERSEDES` | Decision/Adr → Decision/Adr |
| `DECIDES` | Adr → Service/Module/Interface |
| `DEPENDS_ON` | Service/Module → Service/Module/Dependency |
| `CONSTRAINS` | Constraint/Standard → Service/Module |
| `OWNED_BY` | Service/Module → Team |
| `IMPLEMENTS` | Service/Module → Interface |

Encode these as JSON in `.nocciolo/graphiti/ontology.json`. OSS: pass into `add_episode` (`entity_types`, `edge_types`, `edge_type_map`) when the transport supports it. Cloud: `graph.set_ontology` during `configure`.

Extraction instructions (from mission / directives, rewritten):

> Extract durable engineering facts only. Prefer decisions, invariants, ownership, and interfaces. Ignore changelogs, install commands, and secrets. When a later document contradicts an earlier decision, treat it as a supersession, not a second current fact.

If the OSS HTTP API ignores custom types in v1, still write the files and send `custom_extraction_instructions`. Ontology-on-the-wire can follow in a second slice. Do not block seed on perfect type support.

---

## 8. `configure`, `mcp`, `docker`

### `configure`

- Ensure `graphiti` block in `config.json`.
- Write `ontology.json` + `extraction-instructions.md`.
- Cloud: call `set_ontology` and create the graph if the SDK has an explicit create.
- OSS: validate `baseUrl` with a health request when not `--dry-run`.
- Do not start containers.

### `mcp`

Print (and optionally `--write`) snippets that use the **official** endpoint. Nocciolo only fills `group_id` / URL.

Cursor example to emit:

```json
{
  "mcpServers": {
    "graphiti": {
      "url": "http://localhost:8000/mcp/"
    }
  }
}
```

Add a short AGENTS.md / Cursor rule only if `--write-agents` / `--write-cursor-rules` is passed:

> Prefer the project Graphiti graph (`group_id` = `nocciolo-{bankId}`). Search facts before answering architecture or “why” questions. Do not call `clear_graph`.

Cloud snippets use Zep’s current MCP docs and `ZEP_API_KEY` via env placeholder. If Cloud MCP tool names change, update templates only — keep them out of seed code.

### `docker`

`print` only in v1:

```text
# Official Graphiti MCP + FalkorDB (from getzep/graphiti)
# https://github.com/getzep/graphiti/tree/main/mcp_server
cd graphiti/mcp_server
cp .env.example .env   # set OPENAI_API_KEY
docker compose up
# MCP: http://localhost:8000/mcp/
```

Do not vendor their compose. Do not implement `docker up` until someone asks twice.

---

## 9. Implementation slices

Build in this order. Stop after slice 2 if the transport spike fails.

### Slice 0 — Prerequisite

- [ ] Phase A: `MemoryProvider` + `HindsightProvider` + `--provider` dispatch
- [ ] Config schema accepts `provider: "graphiti" | "zep"` and a `graphiti` block

### Slice 1 — Transport spike (half day, throwaway or kept as a test)

- [ ] Local official compose
- [ ] One episode in, one search out
- [ ] Record which HTTP shape worked in `oss-transport.ts`

### Slice 2 — Seed vertical slice

- [ ] `GraphitiProvider` + OSS transport
- [ ] `init --provider graphiti` / `configure`
- [ ] `seed --dry-run` maps candidates → episodes (sorted, hashed)
- [ ] `seed` posts new/changed episodes, updates manifest
- [ ] Progress banner + early auth failure
- [ ] Unit tests for `map-episode.ts` and manifest skip/append (no live graph)

### Slice 3 — Ontology + ADR JSON

- [ ] Ship `software-v1`
- [ ] Send types / instructions when the API allows
- [ ] JSON ADR shaping when the scanner can parse fields

### Slice 4 — Cloud + thin UX

- [ ] `runtime: cloud` + `@getzep/zep-cloud`
- [ ] `--provider zep` alias
- [ ] `mcp` print/write
- [ ] `docker print`
- [ ] User doc section in README (“Using Nocciolo with Graphiti”)

### Slice 5 — Harden (only after a real repo seed)

- [ ] `--reset-graph`
- [ ] Health / status
- [ ] Rate-limit copy (`SEMAPHORE_LIMIT` is Graphiti’s, not ours — document it)
- [ ] Tune ontology on this repo + one typical service repo

Mem0 may still ship before Graphiti. That is fine. This provider is not blocked on Mem0; it is blocked on Slice 0 and a working transport.

---

## 10. Tests

| Test | What it locks |
|------|----------------|
| `map-episode` unit | id → name, git date → `reference_time`, ADR JSON vs text fallback, `source_description` |
| Manifest unit | skip unchanged, append on hash change, `--force` emits all, never calls reset |
| Config validation | `zep` alias, default `groupId`, reject stored API keys |
| Dry-run integration | scanner fixtures → printed episode list, zero HTTP |
| Live OSS smoke (optional CI) | gated on `NOCCIOLO_GRAPHITI_SMOKE=1`; one episode + search |

Do not require Neo4j or Zep Cloud in default CI.

---

## 11. Risks (implementation)

| Risk | Handle |
|------|--------|
| FastAPI thinner than `graphiti_core.add_episode` | Slice 1 decides; do not guess |
| Official MCP still “experimental” | Seed via REST/SDK; MCP is emit-only templates |
| Users expect Nocciolo to start Graphiti | README + `docker print` point at official compose |
| Sloppy re-seeds duplicate current facts | Manifest + temporal-append copy in the CLI warning |
| Default Graphiti types pollute the graph | `configure` writes `software-v1` before first seed |
| LLM cost on first seed | Same warning as Hindsight retain |

---

## 12. Success criteria

A developer who already runs official Graphiti MCP can:

```bash
pnpm nocciolo init --provider graphiti --yes
pnpm nocciolo seed --dry-run
NOCCIOLO_GRAPHITI_URL=http://localhost:8000 pnpm nocciolo seed
```

and get a `group_id=nocciolo-{bankId}` graph that contains project decisions/services from the repo — not an empty graph waiting for the agent to `add_episode` by hand.

Changing an ADR and re-running `seed` adds a new episode and leaves the previous one in the graph.

Hindsight commands without `--provider graphiti` are unchanged.

---

## Roadmap snippet

Paste into `ROADMAP.md` under Phase 6 (or replace the single “Multi-provider support” bullet with the block below).

```markdown
- [ ] Multi-provider foundation (extract `HindsightProvider`, `--provider` dispatch)
- [ ] Mem0 adapter (see `MULTI_PROVIDER_PLAN.md`)
- [ ] Graphiti / Zep adapter — **seed destination only** (see `docs/graphiti.md`)
  - [ ] OSS HTTP transport spike (`add_episode` + `group_id`)
  - [ ] `init` / `configure` / `seed --dry-run` / incremental `seed`
  - [ ] Software ontology (`software-v1`) + extraction instructions
  - [ ] Optional Zep Cloud runtime (`--provider zep`)
  - [ ] `mcp` / `docker print` point at official Graphiti docs — do not vendor compose
- [ ] Cognee adapter (later)
```

Phase 6 goal line can stay as-is. Graphiti is an option on the CLI, not a new phase and not a default.
