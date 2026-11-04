# Developer end-to-end test plan

Manual walkthrough that mirrors how a **new user** sets up a knowledge bank with Orto. Use this after CLI changes (especially `docker`, `mcp`, `seed`, config paths) to catch sequence bugs and edge cases that unit tests miss.

Companion docs: [dev-workflow.md](./dev-workflow.md) (day-to-day loop), [cli-architecture.md](./cli-architecture.md) (modules), [sensitive-data.md](./sensitive-data.md).

## Goals

- Exercise commands in **end-user order**, not contributor convenience order
- Verify actionable errors, `--dry-run`, and no secret leakage in printed output
- Confirm the loop: local Hindsight → config → template → seed → agent MCP wiring

## Prerequisites

| Need | Notes |
|------|--------|
| Node.js 20+ | `node -v` |
| pnpm | `pnpm -v` |
| Docker Desktop (or engine) running | `docker info` |
| LLM API key | `OPENAI_API_KEY` or `HINDSIGHT_API_LLM_API_KEY` (Hindsight retain needs an LLM) |
| Optional tenant API key | Any secret string, e.g. `dev-tenant-key`: used for container auth + Orto seed |

**Never** commit real keys. Prefer process-scoped env:

```bash
export OPENAI_API_KEY='your-llm-key'
export ORTO_HINDSIGHT_API_KEY='dev-tenant-key'   # only if you enable tenant auth on docker up
```

## Build gate (always first)

From the Orto repo:

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm orto --help
```

**Pass:** all green; help lists `init`, `configure`, `seed`, `mcp`, `docker`.

Rebuild (`pnpm build`) after any TypeScript change before continuing.

---

## Recommended setup: fresh fixture project

Dogfooding this repo works, but a **temp directory** best simulates a new user (no existing `.orto/`). Put `orto` on your PATH once from the built clone, then run the same binary from any fixture directory.

```bash
export ORTO_REPO="/absolute/path/to/orto"   # your built clone
# Existing shared Hindsight server, or a new name if you will `docker up` one:
export HINDSIGHT_CONTAINER="your-container-name"
cd "$ORTO_REPO" && pnpm build && npm link
orto --help

export FIXTURE="$(mktemp -d /tmp/orto-e2e-XXXX)"
cd "$FIXTURE"
git init -q
printf '# Fixture\n\nArchitecture decision: prefer local-first tooling.\n' > README.md
printf '# Agents\n\nPrefer durable docs over chat history.\n' > AGENTS.md
mkdir docs && printf '# Overview\n\nDomain invariant: bank ids stay stable.\n' > docs/overview.md

orto --help
# Optional shorthand for the steps below:
# n() { orto "$@"; }
```

All steps below use bare `orto` on your PATH. The global entry is a symlink to `$ORTO_REPO`, so after TypeScript changes a plain `pnpm build` is enough: no re-link.

`pnpm link --global` is equivalent but requires a one-time `pnpm setup` (plus a new shell) to create the pnpm global bin directory; without it pnpm fails with `ERR_PNPM_NO_GLOBAL_BIN_DIR`.

Unlink later with `npm unlink -g @orto-ai/cli` (or `pnpm unlink --global @orto-ai/cli` if you linked with pnpm).

Set `HINDSIGHT_CONTAINER` to an **existing** Docker container that already hosts your banks, or to a new name if you will start a fresh server with `docker up`. One container can host many banks (`fixture-bank` beside others). Do not `docker down` a shared container at the end unless you intend to stop the whole server.

---

## End-user sequence (happy path)

Run in order. Check the **Pass** line before moving on.

### 0. Docker: print (no execute)

```bash
orto docker print --name "$HINDSIGHT_CONTAINER"
orto docker print --name "$HINDSIGHT_CONTAINER" --api-key 'dev-tenant-key'
```

**Pass:**

- Prints a `docker run … ghcr.io/vectorize-io/hindsight:latest` command
- Ports `8888` / `9999`, container name matches `$HINDSIGHT_CONTAINER` (from `--name`)
- LLM / tenant secrets appear as **env placeholders** (`$OPENAI_API_KEY`, `$ORTO_HINDSIGHT_API_KEY`), never raw key material
- Does not start a container
- One container can host many banks: container name is independent of `bankId`

### 1. Docker: up (or reuse)

If `$HINDSIGHT_CONTAINER` is already running, skip live `up` and only check status:

```bash
orto docker status --name "$HINDSIGHT_CONTAINER"
orto docker up --name "$HINDSIGHT_CONTAINER" --dry-run
# only if the container does not already exist:
# orto docker up --name "$HINDSIGHT_CONTAINER" --api-key "$ORTO_HINDSIGHT_API_KEY"
```

**Pass:**

- `--dry-run` does not create a container
- Status shows **Up** when reusing an existing server
- UI reachable: open `http://localhost:9999` (may take ~30-60s on first pull)
- API: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8888/` (expect non-connection-refused; exact code varies)
- Live `up` when the container already exists fails with an **actionable** hint (already exists → use `status`, or `down` then `up` only if you mean to recreate)

**Edge:** Docker daemon stopped → clear “Docker is not available…” hint with `--dry-run` still printable.

### 2. Init

Prefer non-interactive flags in fixtures (no TTY prompts). Interactive `init` asks for bank id and Docker container name when run in a TTY without flags/`--yes`.

```bash
orto init --dry-run --yes
orto init --bank-id fixture-bank --container-name "$HINDSIGHT_CONTAINER" --yes
orto init   # expect already-initialized error
```

**Pass:**

- Dry-run writes nothing
- Creates `.orto/config.json` with `bankId: "fixture-bank"`, `provider: "hindsight"`, `root: "."`, and `docker.containerName` equal to `$HINDSIGHT_CONTAINER`
- Re-init without `--force` errors with hint to use `--force` or `configure`
- `orto init --force --bank-id fixture-bank --container-name "$HINDSIGHT_CONTAINER" --yes` overwrites when intentionally re-run
- Bank id is project-specific; container name is the shared Hindsight server (not derived from bank id)

### 3. Configure

```bash
orto configure --dry-run
orto configure
orto configure   # expect already-exists error without --force
```

**Pass:**

- Dry-run prints template JSON, no file
- Writes `.orto/hindsight/bank-template.json` (version `"1"`, mission/directives present)
- Re-run without `--force` is actionable
- Import template (or create bank with same `bankId`) in Hindsight UI before live seed

### 4. Seed: dry-run

```bash
orto seed --dry-run
```

**Pass:**

- **No** Hindsight HTTP calls required (works even if API is down)
- Lists candidates from README / docs with provenance (not `AGENTS.md`)
- Skips empty / low-signal sections with reasons
- Does not create or require `.orto/local/seed-manifest.json` updates for a pure preview (manifest may be absent)

### 5. Seed: live

```bash
# with tenant auth on the container:
ORTO_HINDSIGHT_API_KEY='dev-tenant-key' orto seed

# without tenant auth:
# orto seed
```

**Pass:**

- Do-not-interrupt warning appears
- Progress lines `[i/N] …%` advance; command exits 0
- Summary shows retained count; `.orto/local/seed-manifest.json` written
- Hindsight UI shows memories for `bankId` (after retain; consolidation may still run)
- Wrong/missing key → early **401/403** with hint to set `ORTO_HINDSIGHT_API_KEY` / `--api-key`
- Unreachable URL → failure naming the base URL and suggesting config/env check

### 6. Seed: incremental re-seed

```bash
ORTO_HINDSIGHT_API_KEY='dev-tenant-key' orto seed --dry-run
ORTO_HINDSIGHT_API_KEY='dev-tenant-key' orto seed
```

**Pass:**

- Unchanged sources skipped (content-hash)
- Touch a durable doc, re-run `--dry-run` → only changed candidates planned
- `orto seed --force` re-sends current candidates

Optional:

```bash
ORTO_HINDSIGHT_API_KEY='dev-tenant-key' orto seed --async
```

**Pass:** async submit + operation poll (or clear message if no operation id).

### 7. MCP: print snippets

```bash
orto mcp
orto mcp --harness cursor,claude-code
orto mcp --include-auth
```

**Pass:**

- Header shows `bankId`, base URL, MCP URL `…/mcp/<bankId>/`
- Snippets for Cursor, Claude Code, Claude Desktop, Roo (`streamable-http`), Codex (TOML), Kiro
- `--include-auth` uses placeholders in print/write path (no accidental secret file writes)
- `--harness` filters; unknown harness → actionable error
- Missing `.orto/config.json` → “run `orto init`”

### 8. MCP: write (dry-run then apply)

```bash
orto mcp --write --dry-run
orto mcp --write --write-agents --write-cursor-rules --include-auth --dry-run
orto mcp --write --write-agents --write-cursor-rules --include-auth
orto mcp --write   # expect conflict without --force if hindsight entry exists
orto mcp --write --force
```

**Pass:**

- Dry-run reports paths, **no** files written
- Creates/merges `.cursor/mcp.json` with `hindsight.url` → single-bank MCP URL
- Upserts `AGENTS.md` between `<!-- orto:hindsight-bank -->` markers (idempotent second run)
- Writes `.cursor/rules/hindsight-bank.mdc` with `alwaysApply: true`
- Auth in written Cursor config uses `${env:ORTO_HINDSIGHT_API_KEY}` (not a literal key)
- Existing other MCP servers in `.cursor/mcp.json` are preserved on merge
- Optional: `orto mcp --write-roo --write-kiro --dry-run` then apply if you care about those harnesses

### 9. Docker: status (keep shared server)

```bash
orto docker status --name "$HINDSIGHT_CONTAINER"
orto docker down --name "$HINDSIGHT_CONTAINER" --dry-run
# Do NOT run live `docker down` against a shared container unless you intend to stop
# the whole server (and every bank on it). Leave it up if other projects use it.
```

**Pass:**

- Status reflects running accurately for `$HINDSIGHT_CONTAINER`
- Dry-run `down` prints the remove command but does not execute
- Volume data for that server persists across ups: expected

---

## Edge-case checklist

Run these deliberately; each should fail or warn **clearly**, not hang silently.

| Case | Command / setup | Expect |
|------|-----------------|--------|
| No config | Fresh dir, `orto seed` / `orto mcp` / `orto configure` | Error → run `init` |
| Init twice | `orto init` twice | Error → `--force` |
| Init non-interactive | `orto init --bank-id my-bank --container-name your-container-name --yes` | Config has custom bank id + docker names; no prompts |
| Configure twice | `orto configure` twice | Error → `--force` |
| MCP dry-run alone | `orto mcp --dry-run` | Error → dry-run only with write flags |
| Docker up twice | `orto docker up --name your-container-name` while running | Error → already exists |
| Bad harness | `orto mcp --harness nope` | Lists valid harnesses |
| Auth mismatch | Seed with wrong `ORTO_HINDSIGHT_API_KEY` | 401/403 + key hint |
| Custom URL | `orto seed --dry-run --hindsight-url http://127.0.0.1:8888` | Printed plan uses override |
| Secret in print | `orto docker print --name your-container-name` with `OPENAI_API_KEY` set | Display shows `$OPENAI_API_KEY`, not the secret |
| Sensitive paths | Add `.env` with secrets under fixture; `orto seed --dry-run` | `.env` not retained / denied |

---

## Dogfooding this repository

When testing inside the Orto repo (already has `.orto/`):

```bash
cd /absolute/path/to/orto
pnpm build
pnpm orto docker status --name your-container-name
pnpm orto seed --dry-run
ORTO_HINDSIGHT_API_KEY='…' pnpm orto seed
pnpm orto store --dry-run
pnpm orto prune --dry-run
pnpm orto mcp --write --dry-run
```

Skip or use `--force` on `init` / `configure` unless you intend to reset templates. Prefer **not** committing machine-local MCP experiments unless the team wants shared `.cursor/mcp.json`. This repo’s checked-in config may use a different `docker.containerName`; override with `--name your-container-name` when talking to your shared server.

---

## Suggested regression matrix (after Phase 3 changes)

| Area | Minimum manual checks |
|------|------------------------|
| `docker` | print (no leak), status against `$HINDSIGHT_CONTAINER`, up-again error if already running |
| `init` / `configure` | dry-run, write with `--container-name your-container-name`, duplicate error, force |
| `seed` | dry-run, live, incremental skip, `--force`, auth failure |
| `store` | dry-run buckets, `--yes` skips new, `--files` allowlists + retains |
| `prune` | dry-run groups, refuse non-interactive without selection, `--document-id --yes` deletes + tombstone, false-positive check on live `orto:` section ids |
| `mcp` | print all, filter harness, write dry-run, write+agents+rules, merge `--force` |

Unit tests (`pnpm test`) still cover pure modules (snippets, docker plan, extractor, client, prune planner, tombstones). This doc is for **sequence and product** behavior.

---

## Time expectations

| Step | Typical duration |
|------|------------------|
| Build + unit tests | under 1 min |
| Docker pull (first time) | several minutes |
| Docker up + UI ready | ~1 min after image present |
| `seed --dry-run` | seconds |
| Live `seed` (first, many candidates) | several minutes (LLM extract per item) |
| `prune --dry-run` | seconds (list documents + local extract) |
| Live `prune` (few ids) | seconds per delete |
| `mcp` print/write | seconds |

Do not treat sync seed “silence between progress lines” as a hang: watch `[i/N]` percent.

---

## Sign-off template

Copy into a PR or issue when you completed a full pass:

```text
E2E pass date:
Fixture / dogfood:
Docker: print / status (reuse `$HINDSIGHT_CONTAINER`; no live down of shared server):
Init + configure (incl. dry-run + duplicate errors):
Seed dry-run + live + incremental:
Store dry-run (optional dogfood):
Prune dry-run (+ optional explicit --document-id --yes):
MCP print + write dry-run + write:
Secret leakage check (docker print / mcp --write):
Notes / bugs found:
```

## Related

- [dev-workflow.md](./dev-workflow.md): build → retain → prune → consolidation tips
- [orto-cli-commands.md](./orto-cli-commands.md): command and flag reference (incl. prune)
- [cli-architecture.md](./cli-architecture.md): command and module map
- [sensitive-data.md](./sensitive-data.md): what must never be retained
- [ROADMAP.md](../ROADMAP.md): phase status
