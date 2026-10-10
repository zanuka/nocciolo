# Mental models with Nocciolo

Use Hindsight mental models so agents get consistent answers to recurring project questions (architecture, standards, "how we work"), not only a bag of retained facts.

Upstream concepts: [Mental Models](https://hindsight.vectorize.io/developer/api/mental-models), [Reflect](https://hindsight.vectorize.io/developer/reflect).
Design details for contributors: [hindsight-mental-models.md](./hindsight-mental-models.md).
Flag reference: [nocciolo-cli-commands.md](./nocciolo-cli-commands.md).

## What you get

A mental model is a **saved reflect response**: a curated summary for a stable query.

During `reflect`, Hindsight checks mental models first, then observations, then raw facts.
That makes common project questions faster and more consistent across agent sessions.

Nocciolo does not invent a second memory system.
It declares models in your version-controlled bank template, applies them to Hindsight, and helps you refresh them after seed.

## Happy path

```text
init
  → configure          # declare starters in bank-template.json
  → bank apply         # create/update models on the live bank
  → seed               # retain durable docs (tags models can read)
  → mental-model refresh --all
  → mcp --write …      # agents prefer reflect for playbook questions
```

Typical commands:

```bash
nocciolo configure --yes
nocciolo bank apply --dry-run
nocciolo bank apply

nocciolo seed --dry-run
nocciolo seed

nocciolo mental-model list
nocciolo mental-model refresh --all

# optional: refresh in the same seed run
nocciolo seed --refresh-mental-models
```

**Important:** after `bank apply`, models can exist with empty content until you refresh.
If the bank already has memories, run `nocciolo mental-model refresh --all` before expecting agents to see summaries.
Create/apply alone is not enough.

## Starter models

`configure` declares three starters by default (stable ids you can re-apply):

| Id | Purpose | Default refresh |
|----|---------|-----------------|
| `project-context` | Purpose, stack, components, conventions | Auto after consolidation |
| `architecture-decisions` | Decisions, trade-offs, rationale | Auto after consolidation |
| `coding-standards` | Style rules and engineering practices | Manual (on demand) |

Defaults use **topic-scoped** tags aligned with what `seed` already stamps (`nocciolo`, `knowledge:architecture`, `knowledge:decision`, `knowledge:standard`).
Multi-tag models set `tags_match: any` so refresh is not empty under Hindsight's default `all_strict`.

You can change this at configure time:

```bash
# Interactive (TTY): pick models, tagging mode, refresh policy
nocciolo configure --force

# Non-interactive
nocciolo configure --yes --force \
  --models project-context,architecture-decisions,coding-standards \
  --tagging-mode topic-scoped \
  --refresh-policy differentiated
```

| Flag | Useful values |
|------|----------------|
| `--tagging-mode` | `topic-scoped` (default), `project-wide`, `custom` |
| `--refresh-policy` | `differentiated` (default), `auto`, `manual` |

Declarations live in `.nocciolo/hindsight/bank-template.json` and should be committed with the rest of `.nocciolo/`.

## Day-to-day workflow

### Keep models current

1. Update durable docs (README, ADRs, standards).
2. Retain with `nocciolo store` or `nocciolo seed`.
3. Refresh models when you care about the summary catching up:

```bash
nocciolo mental-model list
nocciolo mental-model refresh architecture-decisions
nocciolo mental-model refresh --all
```

Models with `refresh_after_consolidation: true` may also refresh after Hindsight consolidates new observations.
`seed --refresh-mental-models` is an explicit opt-in after retain; it is not the default (refresh costs LLM time).

### Inspect and edit

```bash
nocciolo mental-model get coding-standards --detail content
nocciolo mental-model tags --source memories
nocciolo mental-model tags --source mental_models

nocciolo mental-model create \
  --id release-checklist \
  --name "Release Checklist" \
  --source-query "What is our release checklist and non-negotiable gates?" \
  --tags knowledge:ops \
  --save-template

nocciolo mental-model update coding-standards --name "Coding Standards" --save-template
nocciolo mental-model clear coding-standards   # next refresh is a full rebuild
```

Prefer **edit template → `bank apply` → refresh** for team-shared banks.
Use `--save-template` when you edited the live bank and want git to catch up.

### Preview a refresh

```bash
nocciolo mental-model refresh coding-standards --dry-run
```

That calls Hindsight's dry-run-refresh (same LLM cost as a real refresh; nothing is written).
For several models, refresh one id at a time rather than `--all --dry-run`.

## How agents should use the bank

Wire MCP once (`nocciolo mcp --write`, plus `--write-agents` / `--write-cursor-rules` as needed).

| Ask | Prefer |
|-----|--------|
| Architecture, standards, onboarding, "how we work" | `reflect` (or read mental models) |
| Narrow fact + provenance | `recall` |

In the Hindsight Control Plane (default `http://localhost:9999`), open your bank → Knowledge → Mental Models to review the same summaries agents will see.

## Tips that avoid empty or noisy models

1. **Seed before you expect content.** Models synthesize from retained memories.
2. **Refresh after apply** when the bank already has content.
3. **Keep model tags aligned with seed tags.** Changing tags without retagging memories breaks refresh scope.
4. **Use topic-scoped models for playbooks.** Broad project-wide models are coarser onboarding summaries.
5. **Manual refresh for curated policy.** Coding standards and FAQ-style models should not rewrite themselves on every retain.
6. **Do not put secrets in the bank.** Scanner denylists still apply before seed/store.

## Related

- [CLI commands](./nocciolo-cli-commands.md): `configure`, `bank apply`, `seed`, `mental-model`
- [Developer workflow](./dev-workflow.md): first seed and re-seed
- [Team sharing](./team-sharing.md): committing the bank template for teammates
- [Phase 6 dogfood gaps](./phase-6-dogfood-gaps.md): lessons from the nocciolo bank pass
- [Hindsight mental models (design)](./hindsight-mental-models.md): tags, wizard internals, provider boundaries
