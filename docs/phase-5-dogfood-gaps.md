# Phase 5 dogfood gaps: zanuka-web pass

Lessons from dogfooding Nocciolo against [zanuka-web](https://github.com/zanuka/zanuka-web) as a day-to-day ops target.
No zanuka-web patch was attempted in this pass.
Gaps below are upstream Nocciolo (or local ops until they land).

Companion: [phase-4-dogfood-gaps.md](./phase-4-dogfood-gaps.md) (Strumentario), [nocciolo-cli-commands.md](./nocciolo-cli-commands.md), [jev-integration.md](./jev-integration.md).

## What worked

| Step | Outcome |
|------|---------|
| Day-to-day retain | Ops docs now point at `nocciolo store` (allowlist-gated) for ongoing incremental retain |
| Allowlist gate | New durable markdown is not retained until the operator adopts it onto `store.allowlist` |
| Seed retain path | `store` reuses the same retain path as `seed` (no second seeder implementation) |

## Gap 1: Bank document ops parity (blocks archiving the Python seeder)

**Symptom:** zanuka-web still needs its Python seeder (or manual Control Plane / MCP) for bank hygiene that `seed` / `store` do not cover.
`seed` and `store` only add or upsert.
There is no first-class CLI to list retained documents or delete a specific document by id.

**Needed for ops parity:**

1. **`nocciolo prune`** (already planned in Phase 4 / Jev): path-gone, section-gone, explicit `--source` / `--document-id`, tombstones, `--dry-run`
2. **`list-bank-docs` (or equivalent)**: list documents in the configured bank with stable `document_id`s and provenance hints so operators can audit what Python used to list
3. **`delete-doc` (or equivalent)**: delete or invalidate one document by id with `--dry-run`, without waiting for the full interactive prune UX

Until those exist, invalidate or delete via Hindsight Control Plane or MCP (`list_documents`, `delete_document`, `invalidate_memory`).
That keeps the Python seeder alive as the only scripted path for list/delete.

**Product implications:**

1. Ship prune as the primary hygiene command (confirm before delete; local tombstones)
2. Add thin bank-doc list / delete helpers if prune alone is too heavy for scripted ops that today call Python
3. Keep generation/retain (`seed` / `store`) separate from delete/list (provider / seeder concern): do not fold deletes into `store`

## Gap 2: Firstmate `project-bank` (deferred, not a CLI bug)

**Symptom:** Optional `nocciolo mcp --harness firstmate --write-firstmate` was not run.
`$FM_HOME` is unset in this environment, so the CLI correctly prints install steps instead of writing the skill and captain-home registry.

**Not a product defect:** deferred until Firstmate home is configured on the machine.
When ready: set `FM_HOME`, re-run `--write-firstmate`, then crewmates can recall the zanuka-web bank via the on-demand `project-bank` skill.

## Priority

Ordered by what still blocks retiring the Python seeder:

1. **`nocciolo prune`** plus tombstones (Phase 4 checklist)
2. **Bank doc list / delete CLI** if scripted ops need parity sooner than full prune UX
3. **Firstmate wiring** when `FM_HOME` is available (ops, not upstream)

## Non-goals (this pass)

- Patching zanuka-web itself
- Multi-repo MCP naming or deployment profiles (Strumentario / Phase 5 sharing checklist)
- Mental-model lifecycle CLI (Phase 6)

## Sign-off

zanuka-web Phase 5 dogfood: day-to-day ops document `nocciolo store` (allowlist-gated).
Remaining: prune / list-bank-docs / delete-doc parity so the Python seeder can be archived; optional Firstmate `project-bank` once `FM_HOME` is set.
No zanuka-web patch attempted.
