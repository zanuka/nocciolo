# Team sharing and deployment profiles

How a team publishes one durable project bank and lets agents across the org inherit it.

Nocciolo stays **local-first by default**.
Self-host on a machine, LAN, or VPN when you want full control.
[Hindsight Cloud](./hindsight-cloud.md) is an **opt-in** profile, never a forced path.

Companion docs: [CLI commands](./nocciolo-cli-commands.md), [knowledge-base configs](./nocciolo-configs.md), [Hindsight Cloud](./hindsight-cloud.md), [company brain](./company-brain.md).

---

## When you need this

Use team sharing when:

- More than one person (or more than one agent harness) should recall the same project bank
- A multi-root Cursor workspace attaches several banks and generic MCP server names collide
- Teammates should bootstrap from git-tracked `.nocciolo/` without a manual Control Plane import
- The bank is reachable somewhere other than `localhost` (LAN, VPN, public host, or Cloud)

If you are solo on one machine with Docker on localhost, the happy path is still:

```bash
nocciolo init
nocciolo configure
nocciolo bank apply
nocciolo seed
nocciolo mcp --write --write-agents --write-cursor-rules --include-auth
```

Team sharing adds an explicit **deployment profile** and shareable artifacts so that path works for others.

---

## What gets shared (and what does not)

| Layer | Commit? | Role |
|-------|---------|------|
| Project docs (README, ADRs, standards) | Yes | Source of truth |
| `.nocciolo/config.json` | Yes | Portable project identity (`bankId`, optional `deploymentProfile`) |
| `.nocciolo/share.json` | Yes | Deployment profile + non-secret base URL strategy |
| `.nocciolo/hindsight/bank-template.json` | Yes | Mission, directives, mental-model declarations |
| Agent wiring (`.cursor/mcp.json`, rules, `AGENTS.md` section) | Often yes | Points agents at the bank |
| `.nocciolo/local/` (seed manifest, tombstones) | **No** | Machine-local incremental state |
| API keys / OAuth tokens | **No** | Env vars or secret channel only |

Docs stay authoritative.
The bank is the agent-facing index of those docs (with provenance).

---

## Deployment profiles

Choose a profile with `nocciolo share`.
That writes `.nocciolo/share.json` and sets `deploymentProfile` in `config.json`.

| Profile | Typical base URL | Who can reach it | Docker helper |
|---------|------------------|------------------|---------------|
| `local` | `http://localhost:8888` | Same machine | `nocciolo docker` OK |
| `lan` | Team host on trusted LAN (required in share.json) | LAN peers | Optional on the host |
| `vpn` | Private hostname only on VPN (required) | VPN members | Optional on the host |
| `public` | Intentionally exposed self-host URL (required) | Anyone who can hit the host | Harden the host |
| `hindsight-cloud` | `https://api.hindsight.vectorize.io` | Cloud org members | Skipped |

### Security defaults and trade-offs

**local**

- Bind Hindsight to localhost only.
- Tenant API keys are optional locally, recommended once more than one user shares the machine.
- Never commit keys; use `NOCCIOLO_HINDSIGHT_API_KEY` / `HINDSIGHT_API_KEY` in the process environment.

**lan**

- Expose Hindsight only on a trusted LAN.
- Prefer TLS termination or an SSH/VPN tunnel when the LAN is mixed-trust.
- Require a tenant API key; rotate it when people leave the network.
- Firewall the Control Plane UI if teammates only need MCP/API access.

**vpn**

- Reachability should require VPN membership; do not publish the bank on the public internet.
- Treat VPN membership as network auth, not application auth: still use API keys.
- Document the private hostname in `share.json` `baseUrl` (no secrets).

**public**

- Intentional public exposure: use TLS, strong API keys, and rate limits on the host.
- Only use this when the knowledge is meant to be open.
- Still never seed secrets ([sensitive-data.md](./sensitive-data.md)).

**hindsight-cloud**

- Managed host; skip local Docker.
- API key required for `seed` / `bank apply`.
- Default MCP emission is bank-scoped Cloud URL + env key placeholder.
- Optional OAuth MCP for interactive IDEs (`nocciolo share --profile hindsight-cloud --mcp-auth oauth`).
- Retain/reflect consume Cloud credits; review billing and data residency before adopting.
- Full Cloud guide: [hindsight-cloud.md](./hindsight-cloud.md).

---

## Share artifact

```bash
nocciolo share --profile local
nocciolo share --profile lan --base-url http://192.168.1.10:8888
nocciolo share --profile vpn --base-url https://hindsight.internal.example
nocciolo share --profile public --base-url https://brain.example.com
nocciolo share --profile hindsight-cloud
nocciolo share --validate
nocciolo share --profile lan --base-url http://192.168.1.10:8888 --dry-run
```

Example `.nocciolo/share.json` (LAN):

```json
{
  "version": 1,
  "profile": "lan",
  "baseUrl": "http://192.168.1.10:8888"
}
```

Example Cloud:

```json
{
  "version": 1,
  "profile": "hindsight-cloud",
  "mcpAuth": "api-key"
}
```

Resolution order for the Hindsight base URL:

1. `--hindsight-url`
2. `hindsightBaseUrl` in `config.json`
3. `NOCCIOLO_HINDSIGHT_URL` / `HINDSIGHT_URL`
4. `baseUrl` in `share.json` (or Cloud default)
5. Profile default (`local` → `http://localhost:8888`)

API keys are never stored in git.
Set them in the environment (or pass `--api-key` for a single run).

---

## Team bootstrap (recommended)

One maintainer prepares the bank once.
Teammates clone and connect.

### Maintainer

```bash
nocciolo init
nocciolo configure
nocciolo share --profile <local|lan|vpn|public|hindsight-cloud> [--base-url <url>]
nocciolo bank apply --dry-run
nocciolo bank apply
nocciolo seed --dry-run
nocciolo seed
nocciolo mcp --write --write-agents --write-cursor-rules --include-auth
```

Commit `.nocciolo/config.json`, `.nocciolo/share.json`, `.nocciolo/hindsight/bank-template.json`, and the agent wiring you want others to inherit.
Distribute API keys out of band.

`nocciolo configure --apply` is an alias path that applies an existing template (or generates then applies).
Prefer keeping generation (`configure`) and apply (`bank apply`) as separate mental steps.

### Teammate

1. Clone the repo (and pull the committed `.nocciolo/` files).
2. Set env for the active profile:

```bash
# Self-host example
export NOCCIOLO_HINDSIGHT_URL=http://192.168.1.10:8888
export NOCCIOLO_HINDSIGHT_API_KEY=...

# Or Cloud
export NOCCIOLO_HINDSIGHT_URL=https://api.hindsight.vectorize.io
export NOCCIOLO_HINDSIGHT_API_KEY=hsk_...
```

3. Validate and wire agents:

```bash
nocciolo share --validate
nocciolo mcp --write --include-auth --force
nocciolo mcp --check
```

4. Day-to-day: edit durable docs → `nocciolo store` → `nocciolo prune` as needed.
   Seed is for bootstrap; store is the ongoing allowlist-gated path.

For Cloud org invites, console, and OAuth MCP trade-offs, see [hindsight-cloud.md](./hindsight-cloud.md).

---

## Multi-repo / multi-root MCP

Each project bank needs a distinct MCP server name in Cursor (and other harnesses).

Nocciolo defaults to:

```text
hindsight-<bankId>
```

Example in a multi-root workspace:

| Repo | bankId | MCP server name | MCP URL |
|------|--------|-----------------|---------|
| nocciolo | `nocciolo` | `hindsight-nocciolo` | `http://localhost:8888/mcp/nocciolo/` |
| strumentario | `strumentario` | `hindsight-strumentario` | `http://localhost:8888/mcp/strumentario/` |

Override when needed:

```bash
nocciolo mcp --server-name my-custom-name --write --force
```

Probe connectivity (never prints secrets):

```bash
nocciolo mcp --check
nocciolo mcp --check --include-auth
```

### Cursor auth gotcha

`NOCCIOLO_HINDSIGHT_API_KEY` / `HINDSIGHT_API_KEY` must be visible to the **Cursor process**, not only an integrated terminal.
Missing or empty env often shows up as MCP `401 Invalid API key`.
Set the var in your login shell / desktop environment, restart Cursor, then reload MCP servers.

Written MCP configs use env placeholders (for example `Bearer ${env:NOCCIOLO_HINDSIGHT_API_KEY}`).
Do not commit literal keys.

---

## Bank template apply

`configure` only writes JSON.
Teams need an automatable create/update step so mission and directives match git.

```bash
nocciolo bank apply --dry-run
nocciolo bank apply
# or
nocciolo configure --apply --dry-run
nocciolo configure --apply
```

Apply is idempotent for:

- Bank profile / config (missions, extraction mode, disposition, entity labels)
- Directives (matched by name)
- Declared mental models (matched by stable `id`)

Creating a mental model may start an async reflect.
If the bank was empty, refresh mental models again after the first successful `seed` (Phase 6 lifecycle CLI will deepen this).

Actionable errors distinguish auth failures, missing template, and bad template version.
On Cloud, apply requires an API key.

---

## Inventory and hygiene for shared banks

| Need | Command |
|------|---------|
| Flat document inventory (scripts) | `nocciolo docs list` / `nocciolo docs list --json` |
| Preview stale docs | `nocciolo prune --dry-run` |
| Delete one document | `nocciolo prune --document-id <id> --yes` |
| Ongoing retain | `nocciolo store --dry-run` then `nocciolo store` |

Retain (`seed` / `store`) only adds or upserts.
Prune removes path-gone / section-gone / explicit documents and writes local tombstones under `.nocciolo/local/` (not shared via git).

---

## Profile-aware MCP emission

`nocciolo mcp` reads the active profile from `share.json` / `config.deploymentProfile`.

| Profile | Emitted MCP URL (default) | Auth in snippets |
|---------|---------------------------|------------------|
| `local` / `lan` / `vpn` / `public` | `{baseUrl}/mcp/{bankId}/` | Optional via `--include-auth` |
| `hindsight-cloud` + `api-key` | `https://api.hindsight.vectorize.io/mcp/{bankId}/` | Env key placeholder (recommended) |
| `hindsight-cloud` + `oauth` | `https://mcp.hindsight.vectorize.io` | Interactive OAuth (org-scoped; see Cloud doc) |

For project company brains, prefer bank-scoped API URL + env key so each repo pins one `bankId`.
Use OAuth as an alternate for personal exploration.

---

## Checklist

- [ ] `bankId` is project-specific and stable across the team
- [ ] `.nocciolo/share.json` names the deployment profile (and `baseUrl` when not local/Cloud)
- [ ] No API keys in git
- [ ] Maintainer ran `bank apply` then `seed` (or teammates can apply + seed against a shared host)
- [ ] `nocciolo mcp` emits bank-scoped server names (`hindsight-<bankId>`)
- [ ] Cursor (or other harness) has the key in the **process** environment
- [ ] Multi-root workspaces show one MCP connection per bank
- [ ] Cloud users skip `nocciolo docker` and use Cloud keys / org invites

---

## Related

- [nocciolo-cli-commands.md](./nocciolo-cli-commands.md): `share`, `bank apply`, `mcp`, `docs list` flags
- [nocciolo-configs.md](./nocciolo-configs.md): `.nocciolo/` layout
- [hindsight-cloud.md](./hindsight-cloud.md): managed hosting deep dive
- [phase-4-dogfood-gaps.md](./phase-4-dogfood-gaps.md): Strumentario lessons that drove this design
- [phase-5-dogfood-gaps.md](./phase-5-dogfood-gaps.md): zanuka-web ops lessons (`store` / prune / list)
- [ROADMAP.md](../ROADMAP.md): Phase 5 status
