# Phase 6 dogfood gaps: nocciolo bank pass

Lessons from dogfooding Phase 6 mental models against this repo’s live bank `nocciolo` on local Hindsight **0.10.3** (`suchconfig-hindsight`, volume `hindsight-data`).

Companion: [mental-models.md](./mental-models.md) (user guide), [hindsight-mental-models.md](./hindsight-mental-models.md), [nocciolo-cli-commands.md](./nocciolo-cli-commands.md), issue [#64](https://github.com/zanuka/nocciolo/issues/64).

## Dogfood sequence (what we ran)

| Step | Command / check | Outcome |
|------|-----------------|---------|
| Upgrade | `nocciolo docker upgrade --to 0.10.3 -y` | 0.9.2 → 0.10.3; all 6 banks fact counts unchanged |
| Apply dry-run | `nocciolo bank apply --dry-run` | Previewed creates (see gap: dry-run create/update accuracy, fixed) |
| Apply | `nocciolo bank apply` | Created 3 models + 4 directives |
| List / tags | `mental-model list`, `tags --source memories\|mental_models` | Tags align with seed (`nocciolo`, `knowledge:*`) |
| Get after create | `mental-model get project-context --detail content` | **Empty content** until explicit refresh |
| Refresh | `mental-model refresh <id>` ×3 | Each about 2 to 3 min; poll to completed; content populated |
| Re-apply | `nocciolo bank apply` | All mental models **update** (idempotent) |
| Dry-run refresh | `mental-model refresh coding-standards --dry-run` | Upstream dry-run-refresh works (`would_persist`, scope, facts) |
| Agent path | MCP `list_mental_models`, `get_mental_model`, `reflect` | Models present; reflect answered from coding-standards content |

Not run this pass (optional follow-ups): interactive `configure` wizard TTY, `seed --refresh-mental-models` on a full re-seed, `clear` + re-refresh, `--save-template`.

## What worked

| Area | Notes |
|------|-------|
| Seed-aligned tags | Memory tags include `nocciolo`, `knowledge:architecture`, `knowledge:decision`, `knowledge:standard`; model tags match |
| Differentiated refresh | Template kept coding-standards `refresh_after_consolidation: false`; evolving models auto |
| Lifecycle CLI | list / get / refresh / tags / dry-run-refresh usable on 0.10.3 |
| Idempotent apply | Second apply updates models; no duplicates |
| Reflect path | `reflect` on standards-style questions returned playbook content consistent with the mental model |
| Upgrade safety | Volume-backed banks survived 0.9.2 → 0.10.3 |

## Gap 1: Create leaves empty content (needs explicit refresh)

**Symptom:** Immediately after `bank apply`, `get … --detail content` showed `content: ""` with `last_refreshed_at` set and `last_memory_seen_at` / `reflect_response` null.

**Why:** Create starts an async reflect; with an empty or racing first pass, content stays empty until `mental-model refresh`.

**Ops rule:** After apply on a bank that already has memories, always run `nocciolo mental-model refresh --all` (or `seed --refresh-mental-models` after retain). Do not assume create filled the models.

**Product:** Apply success copy now points at refresh. Optional later: wait/poll create operations in apply, or auto-refresh after create when the bank already has facts.

## Gap 2: `refresh --all --dry-run` is slow and silent

**Symptom:** `mental-model refresh --all --dry-run` sat with only “Would refresh 3 declared model(s)” for several minutes (each dry-run-refresh is a full LLM reflect).

**Ops rule:** Prefer single-id dry-run, or skip dry-run and run live refresh one model at a time when dogfooding.

**Product (optional):** Progress lines per model; warn that dry-run costs the same as live refresh.

## Gap 3: Broad `project-context` quality lag

**Symptom:** After refresh, `project-context` (tag `nocciolo`, all memories in scope) produced thinner / less accurate prose than topic-scoped `architecture-decisions` and `coding-standards`.

**Ops rule:** Prefer topic-scoped models for agent playbooks; treat project-context as a coarse onboarding summary.

**Product (optional):** Tighten `project-context` source_query; consider `tags_match` / fact-type limits; or default project-context to untagged / narrower query.

## Gap 4: Apply dry-run create/update accuracy (fixed this pass)

**Symptom:** First dry-run always reported `create` for directives/models because dry-run skipped list APIs.

**Fix:** `applyBankTemplate` now lists directives and mental models on dry-run (GET only) so create vs update is accurate.

## Priority

1. **Ops:** document refresh-after-apply (done in apply next-step copy + this doc)
2. **Optional UX:** progress for multi dry-run / refresh-all
3. **Optional quality:** tighten project-context starter query / scope
4. **Optional:** poll create operations during apply when bank already has content

## Non-goals (this pass)

- Re-seeding the whole bank
- Dogfooding zanuka-web / strumentario mental models
- Jev freshness / routing (JEV-16 / JEV-25)
- Delta-mode playbooks

## Sign-off

Phase 6 dogfood on bank `nocciolo` @ Hindsight 0.10.3: apply → refresh → reflect path works.
Tags and idempotent apply look correct.
Main operational lesson: **refresh after apply**; do not trust empty create content.
Follow-ups above are polish, not blockers for closing [#64](https://github.com/zanuka/nocciolo/issues/64).
