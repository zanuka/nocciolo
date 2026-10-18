# Jev product rule

Jev is an **opt-in judge**, not a memory backend and not a CLI provider.

Nocciolo's job does not change: scan the repo, curate durable knowledge, seed a Hindsight bank, prune stale documents, emit harness config, and apply after confirmation.
Jev answers narrow, typed questions about that work.
Nocciolo keeps every side effect.

**Status:** Product rule for Phase 7 ([JEV-1](https://github.com/zanuka/nocciolo/issues/20)).
Judge port: [JEV-2](https://github.com/zanuka/nocciolo/issues/21) (`src/judge/`, `--judge` / `--confidence` / `--strict` on seed/store/prune).
Keep/skip and prune annotation wiring are still planned.
**Related:** [jev-integration.md](./jev-integration.md) (where it sits), [jev-diagrams.md](./jev-diagrams.md) (store / update flows), [jev-benefits-and-costs.md](./jev-benefits-and-costs.md), [ROADMAP.md](../ROADMAP.md) Phase 7, [JEV-0](https://github.com/zanuka/nocciolo/issues/58).

---

## Job split

| Nocciolo owns | Jev returns |
|---------------|-------------|
| Scan, denylist, extract candidates, content hashes | [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), [Noul](https://docs.typesafe.ai/primitives/noul) |
| Retain, prune, share, MCP I/O, tombstones | Probabilities and confidence |
| Missions, ADRs, MCP snippets, mental-model prose in git | Nothing that writes the bank or the repo |

Code stays in control.
Jev never stores the bank and never authors project docs.

---

## Opt-in only

Enable Jev only when both are present:

- CLI: `--judge jev`
- Env: `NOCCIOLO_TYPESAFE_API_KEY` (TypeSafe key)

The Hindsight API key (`NOCCIOLO_HINDSIGHT_API_KEY` / `HINDSIGHT_API_KEY`) never implies Jev.
`--provider jev` must not exist.
Hindsight remains the default memory path.

---

## Offline fallback

Without `--judge jev`, the CLI uses offline heuristics and makes no TypeSafe call.

With `--judge jev`:

- Missing `NOCCIOLO_TYPESAFE_API_KEY` is a hard error (unset the flag to keep heuristics).
- Network / timeout / 429 / 5xx: warn once and fall back to heuristics for that run.
- Pass `--strict` to fail instead of falling back.

---

## Do not build

| Build | Do not build |
|-------|----------------|
| `Judge` modes: `off` / `heuristic` / `jev` behind `--judge` | `--provider jev` or a Jev memory adapter |
| Confidence gate (`--confidence`) before apply | Silent auto-retain, auto-prune, or auto-share |
| Sanitize state before any TypeSafe call (secrets, denylist, size) | Sending the whole repo or a bank dump as Jev state |
| Point at official TypeSafe docs and [agent skill](https://docs.typesafe.ai/agent-skill) | Vendoring TypeSafe's installer, plugin marketplace, or skill as if Nocciolo owned them |
| Preview keep/skip scores in `seed --dry-run --judge jev` | Jev-generated mission, ADR, MCP, or mental-model prose |
| Annotate prune candidates; delete only after Nocciolo confirm | Auto-delete bank items from a Jev answer alone |

Same installer rule as Graphiti: thin pointers to official URLs, no wrap of their install path.
See [graphiti-integration.md](./graphiti-integration.md) product rule.

---

## What Jev is for

Bounded decisions where a typed answer plus confidence is enough:

- Section relevance and keep/skip before retain
- Knowledge-kind, contradiction, citation support, PII / secret second pass
- Seed priority and retain budget; `store` allowlist proposals and durability gates
- Prune / audit plans for outdated, irrelevant, or contradicted items (including when the file is still on disk)
- Bank-template fitness scores (mission / directives / tags / mental-model questions); prose stays in the template
- MCP `retain` guardrails, recall rerank, still-true checks, `reflect` vs `recall` vs mental-model routing
- Firstmate routing and escalation when confidence is low
- Share / deployment-profile safety before public or Cloud exposure
- Golden-set eval that scores offline heuristics without requiring Jev at runtime

Detail and sequencing: [jev-integration.md](./jev-integration.md) and the Phase 7 checklist in [ROADMAP.md](../ROADMAP.md).

---

## Confidence-gated routing

Choice and Score answers include confidence.
Default `--confidence` is **0.8**.
Nocciolo routes on that score:

- At or above `--confidence`: apply the Nocciolo side effect the operator already authorized (retain, prune selection, share check, Firstmate route).
- Below threshold: dry-run queue, unchecked prune row, or Firstmate captain escalation.
- Never silent apply on low confidence.

Pattern reference: [Confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing).

---

## State budget

Send only what the question needs:

- the candidate section (or small equivalent)
- bank mission / short directive context when relevant
- a short list of overlapping observations or document ids

Do not send secrets, denylisted paths, the full repo tree, or a full bank export.
Secrets stop at scan before extract or Jev.
State sanitization is [JEV-3](https://github.com/zanuka/nocciolo/issues/22).

---

## TypeSafe pointers

- [Introduction](https://docs.typesafe.ai/introduction)
- [System One](https://docs.typesafe.ai/concepts/system-one)
- [Primitives (Choice / Score / Noul)](https://docs.typesafe.ai/primitives)
- [Confidence](https://docs.typesafe.ai/confidence)
- [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
- [Models](https://docs.typesafe.ai/models)
- [Agent skill](https://docs.typesafe.ai/agent-skill) (official; do not vendor)
