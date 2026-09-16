# Nocciolo CLI commands

Reference for the `nocciolo` command surface.
Flags and behavior match `src/cli.ts`.
Run `nocciolo --help` or `nocciolo <command> --help` for the live list.

Related: [README](../README.md), [CLI architecture](./cli-architecture.md), [developer workflow](./dev-workflow.md), [sync strategy](./nocciolo-sync-strategy.md).

---

## Happy path

```bash
nocciolo init
nocciolo configure
nocciolo seed --dry-run
nocciolo seed
nocciolo mcp --write --write-agents --write-cursor-rules --include-auth
```

Local Hindsight (optional Docker helper):

```bash
nocciolo docker print
nocciolo docker up
nocciolo docker status
nocciolo docker upgrade --to <version> --dry-run
nocciolo docker down
```

Mutating or network commands support `--dry-run` where practical.
`seed --dry-run` previews candidates and never calls Hindsight.

---

## Global

| Command | Description |
|---------|-------------|
| `nocciolo --help` | Top-level help |
| `nocciolo --version` | Package version |

Hindsight connection (for `seed`, `mcp`, `docker upgrade`):

| Source | URL | API key |
|--------|-----|---------|
| CLI flag | `--hindsight-url` | `--api-key` |
| Config | `hindsightBaseUrl` in `.nocciolo/config.json` | (not stored) |
| Env | `NOCCIOLO_HINDSIGHT_URL` / `HINDSIGHT_URL` | `NOCCIOLO_HINDSIGHT_API_KEY` / `HINDSIGHT_API_KEY` |
| Default | `http://localhost:8888` | none |

Resolve order: CLI flag → config (URL only) → env → default.
Never commit API keys.

---

## `nocciolo init`

Detect the project root and scaffold `.nocciolo/` (config plus layout).

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be written without creating files |
| `--force` | Overwrite an existing `.nocciolo/config.json` |
| `--name <name>` | Project name (defaults to directory name) |
| `--bank-id <id>` | Hindsight bank id (defaults to a slug of the project name) |
| `--container-name <name>` | Local Hindsight Docker container name (default: `hindsight`) |
| `-y, --yes` | Accept defaults without interactive prompts |

In a TTY, `init` prompts for bank id and Docker container name unless flags or `--yes` skip prompts.
Bank id is project-specific.
Container name is shared: one Hindsight container can host many banks.

---

## `nocciolo configure`

Generate a Hindsight bank template under `.nocciolo/hindsight/`.

| Flag | Description |
|------|-------------|
| `--dry-run` | Print the template without writing files |
| `--force` | Overwrite an existing bank template |

The template holds mission, directives, mental models, and extraction policy.
It is separate from project content retained by `seed`.

---

## `nocciolo seed`

Scan durable sources, extract high-signal candidates, and retain them into the configured bank.

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview candidates without calling Hindsight or writing the seed manifest |
| `--force` | Re-seed even when source content hashes are unchanged |
| `--hindsight-url <url>` | Override Hindsight base URL |
| `--api-key <key>` | Hindsight API key (or set env vars above) |
| `--async` | Submit retain asynchronously to Hindsight |

Incremental state lives in `.nocciolo/local/seed-manifest.json` (gitignored).
Stable `document_id`s upsert on re-seed.
See [sync strategy](./nocciolo-sync-strategy.md).

---

## `nocciolo mcp`

Emit MCP and agent wiring for the project bank.
By default prints snippets.
It does not detect your IDE: use write flags for the files you want.

| Flag | Description |
|------|-------------|
| `--harness <list>` | Limit output: `cursor`, `claude-code`, `claude-desktop`, `roo`, `codex`, `kiro`, `firstmate`, or `all` (comma-separated) |
| `--write` | Write/merge project `.cursor/mcp.json` |
| `--write-roo` | Write/merge project `.roo/mcp.json` |
| `--write-kiro` | Write/merge project `.kiro/settings/mcp.json` |
| `--write-agents` | Upsert an `AGENTS.md` section telling agents to prefer the project bank |
| `--write-cursor-rules` | Write `.cursor/rules/hindsight-bank.mdc` (`alwaysApply: true`) |
| `--dry-run` | Preview writes without touching the filesystem (requires at least one `--write*` flag) |
| `--force` | Overwrite an existing `hindsight` MCP entry or Cursor rule file |
| `--hindsight-url <url>` | Override Hindsight base URL for the MCP endpoint |
| `--include-auth` | Add `Authorization` headers; written files use env placeholders |
| `--api-key <key>` | Include this key literally in printed snippets only; file writes still use env placeholders |

Single-bank MCP URL shape: `http://localhost:8888/mcp/<bankId>/`.

`--harness firstmate` is print-only: it prints a `cd` into the Firstmate home followed by a `claude mcp add --transport http …` command wired to this project's single-bank Hindsight URL. There is no `--write-firstmate`; Nocciolo never writes MCP config into the Firstmate home or detects whether Firstmate is installed. The printed notes say to run the command from the Firstmate home, that the wiring is captain-only (do not wire scouts or ships), that it must not write into this product repo, and that the git project should be registered in Firstmate separately.

Once wired, agents use Hindsight MCP tools such as `recall`, `reflect`, and `retain`.
See the [Hindsight MCP tools](../README.md#hindsight-mcp-tools-any-agent) section in the README.

---

## `nocciolo docker`

Local Hindsight Docker helper.
Actions: `up` / `start`, `down` / `stop`, `status`, `print` (default: `print`).

| Flag | Description |
|------|-------------|
| `--dry-run` | Print the docker command without executing |
| `--name <name>` | Container name (default: `config.docker.containerName`, or `hindsight`) |
| `--api-port <port>` | Host port for Hindsight API (default: `8888`) |
| `--ui-port <port>` | Host port for Control Plane UI (default: `9999`) |
| `--image <image>` | Docker image (default: `ghcr.io/vectorize-io/hindsight:latest`) |
| `--llm-api-key <key>` | LLM provider API key (or `OPENAI_API_KEY` / `HINDSIGHT_API_LLM_API_KEY`) |
| `--llm-provider <name>` | `HINDSIGHT_API_LLM_PROVIDER` (`openai`, `anthropic`, `ollama`, …) |
| `--api-key <key>` | Enable tenant API auth on the container (`HINDSIGHT_API_TENANT_API_KEY`) |
| `--no-pull` | Do not pass `--pull always` |
| `--no-detach` | Run attached (`-it`) instead of `-d` |

`status` looks for the container name in config.
If Hindsight already runs under a different name, pass `--name` or update `docker.containerName`.
Do not run `docker up` if ports `8888` / `9999` are already bound.

---

## `nocciolo docker upgrade`

Upgrade the local Hindsight Docker image to a pinned tag.
Backs up all banks, recreates the container on the same data volume, then verifies `/version` and bank fact counts.

| Flag | Description |
|------|-------------|
| `--to <version>` | Target image tag (required; pinned, e.g. `0.9.2`). `:latest` is refused |
| `--dry-run` | Print backup + pull + recreate plan without mutating |
| `--backup-dir <path>` | Backup directory (default under `~/hindsight-bank-backups/`) |
| `--skip-backup` | Skip backups (dangerous; loud warning; default off) |
| `--force` | Recreate even when `api_version` already matches `--to` |
| `--all-banks` | Back up and validate every bank on the instance (default: on) |
| `--bank <id>` | Emphasize this project bank in backup notes (default: config `bankId`) |
| `-y, --yes` | Skip TTY confirmation prompts |
| `--hindsight-url <url>` | Hindsight base URL |
| `--api-key <key>` | Hindsight API key |
| `--name <name>` | Container name |

Full procedure: [hindsight-upgrade.md](./hindsight-upgrade.md).

---

## See also

- [Sync strategy](./nocciolo-sync-strategy.md): curated retain vs file upload
- [Knowledge-base configs](./nocciolo-configs.md): `.nocciolo/` layout and seed manifest
- [Sensitive data](./sensitive-data.md): what the scanner denies before retain
- [Hindsight Cloud](./hindsight-cloud.md): managed hosting instead of local Docker
