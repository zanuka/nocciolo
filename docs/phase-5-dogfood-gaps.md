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

1. **`nocciolo prune`** (shipped for path-gone / section-gone / explicit): `--dry-run`, `--source` / `--document-id` + `--yes`, local tombstones. See [CLI reference](./nocciolo-cli-commands.md#nocciolo-prune).
2. **`list-bank-docs` (or equivalent)**: still open if operators need a full bank inventory without prune candidate grouping (Python `--list-bank-docs` parity)
3. **`delete-doc` (or equivalent)**: largely covered by `nocciolo prune --document-id <id> --yes` (and `--dry-run`); a thinner alias remains optional

Until thin list helpers exist, use `nocciolo prune --dry-run` for candidate inventory, or Hindsight Control Plane / MCP `list_documents` for a full bank listing.

**Product implications:**

1. Prune is the primary hygiene command (confirm before delete; local tombstones)
2. Add thin bank-doc list helpers if prune grouping is too heavy for scripted inventory that today calls Python
3. Keep generation/retain (`seed` / `store`) separate from delete/list (provider / seeder concern): do not fold deletes into `store`

## Gap 2: Firstmate `project-bank` (deferred, not a CLI bug)

**Symptom:** Optional `nocciolo mcp --harness firstmate --write-firstmate` was not run.
`$FM_HOME` is unset in this environment, so the CLI correctly prints install steps instead of writing the skill and captain-home registry.

**Not a product defect:** deferred until Firstmate home is configured on the machine.
When ready: set `FM_HOME`, re-run `--write-firstmate`, then crewmates can recall the zanuka-web bank via the on-demand `project-bank` skill.

## Priority

Ordered by what still blocks retiring the Python seeder:

1. **Bank doc list CLI** (optional) if full inventory without prune grouping is still required for scripts
2. **Dogfood** prune on zanuka-web (dry-run orphans / selective path-id delete) and archive Python prune/list/delete once that passes
3. **Firstmate wiring** when `FM_HOME` is available (ops, not upstream)

## Non-goals (this pass)

- Patching zanuka-web itself
- Multi-repo MCP naming or deployment profiles (Strumentario / Phase 5 sharing checklist)
- Mental-model lifecycle CLI (Phase 6)

## Sign-off

zanuka-web Phase 5 dogfood: day-to-day ops document `nocciolo store` (allowlist-gated).
Remaining: dogfood prune on zanuka-web and optional full bank-list helper so the Python seeder can be archived; optional Firstmate `project-bank` once `FM_HOME` is set.
No zanuka-web patch attempted.
