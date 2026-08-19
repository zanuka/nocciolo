# Nocciolo knowledge-base configs

Nocciolo turns durable project docs into a [Hindsight](https://hindsight.vectorize.io) memory bank that coding agents can **recall** and **reflect** against over MCP.

The configs under `.nocciolo/` are the version-controlled (and machine-local) knobs for that bank. They are not a dump of the repo into a vector store. They name the bank, shape how it extracts and answers, track what was already seeded, and point agent harnesses at the right MCP endpoint.

| Layer | Role |
|-------|------|
| **Docs in git** | Source of truth (README, AGENTS.md, ADRs, architecture notes, …) |
| **`.nocciolo/`** | Project identity, bank template, incremental seed state |
| **Hindsight bank** | Structured memories agents query via MCP |
| **Agent wiring** | MCP URL + rules / AGENTS snippets that steer agents to `recall` / `reflect` |

Docs stay authoritative. The bank is the agent-facing index of those docs: with provenance: so sessions start warm instead of re-reading the whole tree.

---

## What’s under `.nocciolo/`

```text
.nocciolo/
  config.json                 # project identity + bank id (commit)
  hindsight/
    bank-template.json        # Hindsight mission / directives / mental models (commit)
  local/
    seed-manifest.json        # incremental seed state (gitignored; machine-local)
```

Related agent wiring lives **outside** `.nocciolo/` and is emitted by `nocciolo mcp`:

| Path | Purpose |
|------|---------|
| `.cursor/mcp.json` | Cursor MCP entry for the project bank |
| `.cursor/rules/hindsight-bank.mdc` | Always-on rule: prefer bank recall for durable questions |
| `AGENTS.md` section between `<!-- nocciolo:hindsight-bank -->` markers | Same preference for non-Cursor agents |

**Commit:** `config.json`, `hindsight/bank-template.json`, and the MCP / AGENTS / Cursor rule wiring you want teammates to inherit.

**Do not commit:** `.nocciolo/local/` (seed manifest), API keys, or anything under secrets / credential paths. See [sensitive-data.md](./sensitive-data.md).

---

## `config.json`

Written by `nocciolo init`. Portable project identity for this repo.

```json
{
  "version": 1,
  "name": "nocciolo",
  "provider": "hindsight",
  "bankId": "nocciolo",
  "root": ".",
  "docker": {
    "containerName": "hindsight",
    "volumeName": "hindsight-data"
  }
}
```

| Field | Meaning |
|-------|---------|
| `bankId` | Hindsight bank name: **project-specific**. Many banks can share one server. |
| `provider` | Memory backend (`hindsight` today). |
| `root` | Project root relative to config (usually `"."`). |
| `docker.containerName` / `volumeName` | Which **local Docker server** hosts banks: not 1:1 with `bankId`. |
| `hindsightBaseUrl` | Optional default Hindsight URL (still overridable by env / CLI). |

Bank id defaults to a slug of the project directory name; it is never hardcoded to `nocciolo` for other projects. One Docker container is a Hindsight **server** that can hold many banks.

Never store API keys here. Use `NOCCIOLO_HINDSIGHT_API_KEY` / `HINDSIGHT_API_KEY` or `--api-key`.

---

## `hindsight/bank-template.json`

Written by `nocciolo configure`. Importable Hindsight bank template (version `"1"`) that shapes how the bank thinks: separate from the memories themselves.

It typically includes:

- **Retain / observations / reflect missions**: extract durable architecture, standards, and domain facts; ignore secrets and ephemeral noise
- **Entity labels**: e.g. `knowledge_kind` (`decision`, `standard`, `architecture`, …) and `durability` (`stable`, `evolving`, `deprecated`)
- **Mental models**: living summaries (project context, architecture decisions, coding standards) refreshed after consolidation
- **Directives**: prefer durable sources, cite provenance, do not invent conventions, local-first defaults

Example (abbreviated from this repo’s template):

```json
{
  "version": "1",
  "bank": {
    "retain_mission": "This bank holds durable knowledge for the nocciolo software project. Always extract: architectural decisions… Ignore: secrets/credentials…",
    "reflect_mission": "You are the durable project memory for nocciolo. Prefer established architecture, ADRs, coding standards… Do not invent conventions…",
    "disposition_skepticism": 4,
    "disposition_literalism": 4
  },
  "mental_models": [
    {
      "id": "project-context",
      "name": "Project Context",
      "source_query": "What is nocciolo's purpose, tech stack, architecture, and key conventions?"
    }
  ],
  "directives": [
    {
      "name": "prefer-durable-sources",
      "content": "Prefer ADRs, architecture docs, standards, and AGENTS.md over chat history…",
      "priority": 10,
      "is_active": true
    }
  ]
}
```

Commit this file. Import it into Hindsight (Control Plane or API) so mission and directives match the project before or alongside seeding. Applying the template from the CLI (`configure --apply` / `bank apply`) is on the [roadmap](../ROADMAP.md).

The template is the *personality and policy* of the bank. Retained facts are the *content*. Both matter for useful MCP recall.

---

## `local/seed-manifest.json`

Written by live `nocciolo seed`. Tracks **what was already retained** so re-seeds are incremental.

- Per source path: content hash, list of stable fact / `document_id`s, last seeded time
- Unchanged files are skipped on the next `seed` unless you pass `--force`
- Fact ids look like `nocciolo:README.md#the-vision`: Hindsight upserts by id instead of duplicating

This is **machine-local seed state**, not documentation. Prefer keeping it out of git (`.nocciolo/local/` is gitignored). The bank in Hindsight is the shared memory; the manifest only speeds up re-seed on this machine.

Illustrative shape (from a dogfood project):

```json
{
  "version": 1,
  "bankId": "strumentario",
  "updatedAt": "2026-08-07T23:13:46.596Z",
  "sources": {
    "README.md": {
      "contentHash": "…",
      "factIds": [
        "nocciolo:README.md#the-vision",
        "nocciolo:README.md#core-principles"
      ],
      "seededAt": "2026-08-07T22:59:26.952Z"
    },
    "AGENTS.md": {
      "contentHash": "…",
      "factIds": ["nocciolo:AGENTS.md#document"],
      "seededAt": "2026-08-07T23:13:46.596Z"
    }
  }
}
```

`seed --dry-run` previews candidates without writing the manifest or calling Hindsight.

---

## How agents use it (MCP recall)

With a running Hindsight instance and MCP wired to the project bank:

```text
http://localhost:8888/mcp/<bankId>/
```

Example for this repo: `http://localhost:8888/mcp/nocciolo/`.

1. Agent asks a durable question (“What are our architecture boundaries?”, “How do we treat secrets?”)
2. Cursor rule / AGENTS guidance steers it to Hindsight **`recall`** (or **`reflect`** for synthesis)
3. Bank returns structured memories with provenance (source file / section ids), not a raw markdown paste
4. Docs in git remain authoritative; the bank is the agent-facing memory of those sources

Wire the harness after seed:

```bash
nocciolo mcp --write --write-agents --write-cursor-rules --include-auth
```

Auth (when the server requires a tenant key) uses the same secret as seed: set `NOCCIOLO_HINDSIGHT_API_KEY` in the environment the IDE inherits: never commit the key. Refresh MCP in Cursor Settings after writing `.cursor/mcp.json`.

---

## Why put Nocciolo in a project

Without a bank, every agent session rediscovers architecture, standards, and domain rules from scattered files. With Nocciolo:

- **Shared context**: teammates and agents hit the same bank id and template policy
- **Provenance**: recalled facts point back to README / ADR / docs sections
- **Conservative seeding**: only high-signal durable sections; secrets stay out
- **Incremental updates**: change docs → `seed --dry-run` → live `seed`; unchanged sources are skipped
- **Harness-ready MCP**: one command emits Cursor / AGENTS wiring so recall is the default path

Typical loop:

```bash
nocciolo init --bank-id <your-bank> --yes
nocciolo configure
# import .nocciolo/hindsight/bank-template.json into Hindsight

nocciolo seed --dry-run
NOCCIOLO_HINDSIGHT_API_KEY='…' nocciolo seed

nocciolo mcp --write --write-agents --write-cursor-rules --include-auth
```

Update docs when the project evolves; re-seed when you want the bank to catch up. Prefer missing a weak section over injecting noise.

---

## Related

- [README](../README.md): quick start and MCP flags
- [Developer workflow](./dev-workflow.md): first seed, re-seed, retain tips
- [CLI architecture](./cli-architecture.md): config layout and seed pipeline for contributors
- [Sensitive data](./sensitive-data.md): what must never be retained
- [Phase 4 dogfood gaps](./phase-4-dogfood-gaps.md): multi-repo MCP DX and template apply
- [Hindsight bank templates](https://hindsight.vectorize.io/developer/api/bank-templates)
