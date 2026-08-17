# Hindsight mental models in Nocciolo

Design notes for Phase 5. Upstream: [Mental Models API](https://hindsight.vectorize.io/developer/api/mental-models), [Tags and Visibility](https://hindsight.vectorize.io/developer/api/mental-models#tags-and-visibility), [Listing mental model tags](https://hindsight.vectorize.io/developer/api/mental-models#listing-mental-model-tags).

Mental models are **saved reflect responses** — curated summaries for recurring questions. During reflect, Hindsight checks them **before** observations and raw facts. They are Hindsight-native; Mem0 has no equivalent curated-summary layer (see [ROADMAP Phase 5](../ROADMAP.md)).

---

## What tags do

A mental model’s tags control two things at once ([Tags and Visibility](https://hindsight.vectorize.io/developer/api/mental-models#tags-and-visibility)):

| Effect | Behavior |
|--------|----------|
| **What it reads** | On create/refresh, an internal reflect only sees memories that satisfy the model’s tag filter |
| **Who can see it** | On `reflect` / lookup, callers only see models whose tags overlap their request tags |

Same isolation rules as the rest of the bank, applied to synthesized knowledge: a model scoped to one team, customer, or topic is built only from that scope and surfaces only for requests in that scope.

### Refresh matching defaults (critical)

- A **tagged** model defaults to `all_strict` for refresh: a memory must carry **every** tag on the model.
- Untagged memories are excluded when the model has tags.
- Multi-tag models whose memories are tagged narrowly (one topic each) often refresh **empty** unless you set `trigger.tags_match` to `any` (or use `tag_groups`).
- `GET …/tags?source=mental_models` lists tags on models; `source=memories` (default) lists tags on memories — different tag spaces.

Nocciolo must keep **seed retain tags** and **mental model tags** coherent, or first refresh will fail silently into empty content.

---

## Where this fits in the Nocciolo lifecycle

Mental models are **not** an `init` concern. `init` names the bank and local Docker server. Models need a bank template, retained knowledge, and then create/refresh against a live bank.

```text
init          → project identity + bank id
configure     → declare mission, directives, mental models (+ tags) in bank-template.json
configure --apply / bank apply   → create bank + apply declarations (Phase 4)
seed          → retain facts with tags that models can read
mental-model  → create / edit / refresh / clear after the bank has content (Phase 5)
mcp           → agents prefer reflect for playbook-style questions
```

| Stage | Mental-model responsibility |
|-------|-----------------------------|
| **`configure` (wizard)** | Declare starter models: id, name, source query, tags, `tags_match`, refresh policy. Write version-controlled template only — no live Hindsight calls required. |
| **Template apply (Phase 4)** | Idempotent create-or-update of declared models on the bank (stable custom `id`s). |
| **`seed`** | Stamp retain tags that match (or intentionally overlap) model scopes so refresh has something to read. |
| **`mental-model` (post-seed)** | Add, edit, list, refresh, clear against the live bank; optionally write changes back into the template. |
| **Agent wiring** | Tell agents to `reflect` (or read models) for architecture / standards / “how we work,” not only `recall`. |

Do not collapse apply or refresh into `seed`. Generation stays in configure/template; apply is provider integration; refresh is a post-seed lifecycle step.

---

## Tag vocabulary for project banks

Today’s defaults are misaligned:

| Layer | Current tags (example) |
|-------|------------------------|
| Seed retain | `nocciolo`, `kind:adr`, `knowledge:decision`, … |
| Default mental models | `project`, `architecture`, `decisions`, `standards` |

Under `all_strict`, `architecture-decisions` (`["architecture", "decisions"]`) will not see those seeded memories.

**Recommended project-bank defaults:**

1. Prefer **topic tags that seed already emits** (or will emit), e.g. `knowledge:architecture`, `knowledge:standard`, `knowledge:decision`, plus a shared bank tag such as `nocciolo` / project slug if useful for listing.
2. For multi-tag models, set `trigger.tags_match: "any"` unless every memory is expected to carry all tags.
3. Reserve customer/team/user scopes (`team:platform`, `customer:acme`) for multi-tenant or multi-team banks — not the default single-repo project template.
4. Document that changing model tags without retagging memories (or changing `tags_match`) is a breaking refresh change.

Entity labels (`knowledge_kind`, `durability`) on the bank template are **not** the same as memory tags. Labels guide extraction structure; tags drive visibility and refresh scope. Nocciolo may map `knowledge_kind` → `knowledge:<kind>` at seed time so models can filter on a stable vocabulary.

---

## `configure` multi-step wizard

`configure` is currently non-interactive template generation. Phase 5 should add an **optional interactive wizard** when stdin is a TTY (same pattern as `init`). Non-interactive paths stay first-class:

- `nocciolo configure --yes` — accept starter defaults, no prompts
- Flags / CI — generate or overwrite without a wizard
- `--dry-run` — print the resulting template

### Proposed wizard steps

Keep steps short. Prefer selecting from defaults over free-form essays.

1. **Extraction posture** — keep default retain/reflect missions, or lightly edit project name already baked in (advanced: open editor / skip).
2. **Starter mental models** — multi-select which defaults to include:
   - Project Context
   - Architecture Decisions
   - Coding Standards
   - (optional) custom: prompt for `id`, `name`, `source_query`
3. **Tagging mode** (applies to selected models):
   - **Project-wide (recommended)** — models untagged **or** tagged with the shared bank/project tag only; widest refresh + reflect visibility for coding agents
   - **Topic-scoped** — map each model to seed-aligned tags (e.g. Architecture → `knowledge:architecture` / `knowledge:decision`) and set `tags_match: any` for multi-tag models
   - **Custom scopes** — user enters comma-separated tags per model (advanced; warn about `all_strict` empty refresh)
4. **Refresh policy** — per model or batch preset:
   - Auto after consolidation (good for evolving project context)
   - Manual only (good for curated policy / FAQ)
   - Optional later: cron / `delta` for long playbooks
5. **Review** — print model table (id, tags, tags_match, refresh) → confirm write to `.nocciolo/hindsight/bank-template.json`

Wizard output remains the template file. Applying to Hindsight stays `configure --apply` / `bank apply` (Phase 4). The wizard must explain that models stay empty until seed + refresh.

### What the wizard should *not* do

- Call Hindsight to create models before the bank exists or before seed (unless the user explicitly chose apply in the same session — still a separate step).
- Invent customer/tenant isolation for a single-repo “company brain” unless the user picks custom scopes.
- Prompt for every directive by default; keep directive defaults automatic unless an “advanced” path is opened later.

---

## Post-seed command: yes

A dedicated command after seed/sync is the right place for day-2 mental model work. Declaring models at configure time is necessary but not sufficient — content is produced by reflect over retained memories.

### Proposed command surface

```text
nocciolo mental-model list
nocciolo mental-model get <id>
nocciolo mental-model create …          # interactive or flags
nocciolo mental-model update <id> …
nocciolo mental-model refresh <id|--all>
nocciolo mental-model clear <id>        # then refresh for full re-synthesis
nocciolo mental-model tags              # list bank tags: memories vs mental_models
```

All mutating subcommands support `--dry-run`. Async create/refresh should poll operations like `seed` (or print `operation_id` and how to wait).

### Interactive create / edit (post-seed)

When run in a TTY after the bank is seeded:

1. List existing models (`detail=metadata` or `content`) and memory tags (`source=memories`) vs model tags (`source=mental_models`).
2. Create or edit: name, stable `id`, source query, tags (suggest from `mental-model tags` / seed vocabulary), `tags_match`, refresh trigger.
3. Optionally run refresh immediately and print a short preview of content.
4. Ask whether to **persist the declaration** back into `bank-template.json` so the change is version-controlled and re-applicable for teammates.

That last step keeps live bank edits from drifting from git. Prefer “edit template → apply → refresh” for team-shared banks; allow “edit live → write back template” as an explicit opt-in.

### Optional seed hook

`nocciolo seed --refresh-mental-models` (opt-in, not default): after retain succeeds, wait for consolidation if needed, then refresh declared models. Default seed stays retain-only so users are not surprised by LLM cost/time.

---

## Agent usage

Once models exist and have content:

- Prefer **`reflect`** (or `get_mental_model` / list with `detail=content`) for architecture, standards, and onboarding-style questions.
- Prefer **`recall`** for narrow fact lookup and provenance hunting.
- Callers that pass tags on reflect only see models in that tag scope — MCP snippets for a single project bank should usually use **no tags** (or the shared project tag) so project-wide models remain visible.

---

## Implementation boundaries

| Concern | Module |
|---------|--------|
| Wizard prompts / flags | `src/commands/configure.ts` (+ shared prompt utils) |
| Template shape (tags, `tags_match`, triggers) | `src/providers/hindsight/template.ts`, `types.ts` |
| Seed tag vocabulary alignment | `src/seeder/prepare.ts` |
| Live create / list / refresh / clear | `src/providers/hindsight/` client + `src/commands/mental-model.ts` (name TBD) |
| Apply from template | Phase 4 bank apply path |

Keep provider logic out of commands. Do not invent a Mem0 mental-model API; if a future Mem0 adapter needs “curated context,” map it separately (custom instructions / categories), not through this command.

---

## Open decisions

1. Default tagging mode for generated templates: **project-wide** (safest refresh) vs topic-scoped with seed-aligned tags + `tags_match: any`.
2. Whether `mental-model` writes back to the template by default or only with `--save-template`.
3. Whether first-time `configure --apply` should auto-refresh models after the first successful seed, or require an explicit refresh command / flag.

---

## Related

- [ROADMAP.md](../ROADMAP.md) — Phase 5 checklist
- [phase-4-dogfood-gaps.md](./phase-4-dogfood-gaps.md) — bank template apply
- [nocciolo-configs.md](./nocciolo-configs.md) — `.nocciolo/` layout
- [cli-architecture.md](./cli-architecture.md) — module boundaries
- [dev-workflow.md](./dev-workflow.md) — happy path after seed
