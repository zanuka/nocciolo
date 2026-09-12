# Upgrading local Hindsight (Docker)

How to upgrade a **local / self-hosted** Hindsight Docker server while keeping banks on the named data volume. Upstream: [Installation](https://hindsight.vectorize.io/developer/installation), [Admin CLI](https://hindsight.vectorize.io/developer/admin-cli).

Prefer a **pinned tag** (e.g. `0.9.2`) over `latest` so upgrades are intentional.
Nocciolo’s primary path is `nocciolo docker upgrade`.
Manual Docker steps remain as a fallback.

## CLI (recommended)

From a Nocciolo project (uses `.nocciolo/config.json` for container name; volume is taken from live `docker inspect`):

```bash
nocciolo docker upgrade --to 0.9.2 --dry-run
nocciolo docker upgrade --to 0.9.2 -y
nocciolo docker upgrade --to 0.9.2 --backup-dir ~/hindsight-bank-backups/manual-pre-0.9.2 -y
```

What the command does:

1. **Backup**: writes a directory under `~/hindsight-bank-backups/pre-<to>-<timestamp>/` with a full volume tarball (required), optional `hindsight-admin backup` ZIP, bank manifest + stats/exports, and a README (secrets masked).
2. **Upgrade**: pulls `ghcr.io/vectorize-io/hindsight:<to>`, removes **only** the container, recreates it on the **same** named volume with **preserved env** and port bindings.
3. **Validate**: `/version` matches `--to`, `/health` is healthy, every bank `fact_count` matches the pre-upgrade manifest.

Useful flags:

| Flag | Meaning |
|------|---------|
| `--to <version>` | Required pinned tag (refuses `latest`) |
| `--dry-run` | Print backup + pull + recreate plan only |
| `--backup-dir <path>` | Override backup directory |
| `--skip-backup` | Dangerous; skips backups (loud warning; default off) |
| `--force` | Recreate even if already on target version |
| `--all-banks` | Default on: back up / validate every bank on the instance |
| `--bank <id>` | Emphasize project bank in backup notes (defaults to config `bankId`) |
| `-y` / `--yes` | Skip TTY confirms; required for non-interactive runs |
| `--hindsight-url` / `--api-key` | Same resolution as `seed` (prefer env for the key) |

Pending / processing operation fields in bank stats: the CLI **warns** and requires `-y` (or an interactive yes) before continuing.

Consumer MCP URLs (e.g. `http://localhost:8888/mcp/<bankId>/`) stay valid; do not rewrite `.cursor/mcp.json` after a successful upgrade.

0.9.x highlights (informational; this command does **not** install Coding Agents):

- Knowledge Pages + Knowledge Base MCP tools (0.9.2)
- Faster temporal extraction / ops hardening (0.9.1)
- Same retain/recall/reflect banks; MCP URL paths unchanged

## What stays, what does not

| Piece | Survives `docker rm`? | Notes |
|-------|----------------------|--------|
| Named volume (e.g. `hindsight-data` → `/home/hindsight/.pg0`) | **Yes** | Banks and embedded Postgres live here |
| Container filesystem / image | No | Replaced when you pull a new tag |
| Env vars / port maps / restart policy | Re-applied by `upgrade` | Captured from `docker inspect` then passed to the new container |
| Portable ZIP backups | N/A | Separate copies on the host: see [hindsight-bank-backup.md](./hindsight-bank-backup.md) |

`docker rm -f <container>` does **not** delete the volume. `docker volume rm hindsight-data` does: never run that unless you intend to wipe all banks.
`nocciolo docker upgrade` never runs volume delete.

Hindsight runs database migrations on API startup by default (`HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP`).
Recreating the container on the same volume is the supported upgrade path for Docker + pg0.

## Manual fallback

Use these steps only if you cannot run the CLI helper.

### Prerequisites

```bash
export HINDSIGHT_CONTAINER=hindsight          # from init / .nocciolo/config.json
export HINDSIGHT_VOLUME=hindsight-data        # usual default; confirm with inspect
export HINDSIGHT_IMAGE=ghcr.io/vectorize-io/hindsight:0.9.2   # target version
```

Confirm the volume name on your running container:

```bash
docker inspect "$HINDSIGHT_CONTAINER" \
  --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
```

You want a mount of `<volume> -> /home/hindsight/.pg0`.

### 1. Check the current version

```bash
curl -sS http://localhost:8888/version
# → "api_version": "…"

docker inspect "$HINDSIGHT_CONTAINER" --format '{{.Config.Image}}'
```

### 2. Back up before upgrading

Quiesce writes if you can (pause `seed` / retain traffic), then take at least a **full instance** backup and copy it off the container:

```bash
BACKUP="hindsight-backup-$(date +%Y%m%d).zip"
docker exec "$HINDSIGHT_CONTAINER" hindsight-admin backup "/tmp/${BACKUP}"
mkdir -p ~/hindsight-bank-backups
docker cp "${HINDSIGHT_CONTAINER}:/tmp/${BACKUP}" ~/hindsight-bank-backups/
```

Optional: also export important banks one-by-one. Full commands: [hindsight-bank-backup.md](./hindsight-bank-backup.md).

Prefer also tarring the named volume (what the CLI does as the primary artifact):

```bash
docker run --rm \
  -v "${HINDSIGHT_VOLUME}:/data:ro" \
  -v "$HOME/hindsight-bank-backups:/backup" \
  alpine tar czf "/backup/hindsight-data-volume.tar.gz" -C /data .
```

### 3. Capture the current run config

You will recreate the container with the **same** ports, volume, and environment. Dump what matters before removing it:

```bash
docker inspect "$HINDSIGHT_CONTAINER" --format 'Image: {{.Config.Image}}
Env:
{{range .Config.Env}}{{println .}}{{end}}
Ports: {{json .HostConfig.PortBindings}}
Mounts:
{{range .Mounts}}{{println .Name .Destination}}{{end}}'
```

Save the tenant / LLM keys you need (do not commit them). Example:

```bash
export NOCCIOLO_HINDSIGHT_API_KEY="$(
  docker exec "$HINDSIGHT_CONTAINER" printenv HINDSIGHT_API_TENANT_API_KEY
)"
```

If you use Ollama or other custom env (`HINDSIGHT_API_LLM_BASE_URL`, `HINDSIGHT_API_LLM_MODEL`, worker slots, etc.), copy those values into the new `docker run`.
`nocciolo docker up` only covers a subset of flags and may not reproduce a hand-tuned container.
`nocciolo docker upgrade` preserves full env from inspect.

Set a **stable** worker id across restarts (recommended by upstream):

```bash
-e HINDSIGHT_API_WORKER_ID=hindsight-local
```

### 4. Pull the new image

```bash
docker pull "$HINDSIGHT_IMAGE"
```

Tags are published as `ghcr.io/vectorize-io/hindsight:<version>` (and `-slim` variants). See [Available tags](https://hindsight.vectorize.io/developer/installation#available-tags).

### 5. Remove the old container (keep the volume)

```bash
docker rm -f "$HINDSIGHT_CONTAINER"
```

Confirm the volume still exists:

```bash
docker volume ls --filter "name=${HINDSIGHT_VOLUME}"
```

### 6. Start the new container on the same volume

Minimal shape (OpenAI-style LLM key). Adjust env to match what you captured in step 3:

```bash
docker run -d \
  --name "$HINDSIGHT_CONTAINER" \
  --restart unless-stopped \
  -p 8888:8888 \
  -p 9999:9999 \
  -v "${HINDSIGHT_VOLUME}:/home/hindsight/.pg0" \
  -e HINDSIGHT_API_WORKER_ID=hindsight-local \
  -e HINDSIGHT_API_LLM_API_KEY="$OPENAI_API_KEY" \
  "$HINDSIGHT_IMAGE"
```

Example with **tenant auth + Ollama** (common local dogfood setup):

```bash
docker run -d \
  --name "$HINDSIGHT_CONTAINER" \
  --restart unless-stopped \
  -p 8888:8888 \
  -p 9999:9999 \
  -v "${HINDSIGHT_VOLUME}:/home/hindsight/.pg0" \
  -e HINDSIGHT_API_WORKER_ID=hindsight-local \
  -e HINDSIGHT_API_LLM_PROVIDER=ollama \
  -e HINDSIGHT_API_LLM_BASE_URL=http://host.docker.internal:11434/v1 \
  -e HINDSIGHT_API_LLM_MODEL=qwen2.5:7b \
  -e HINDSIGHT_API_TENANT_EXTENSION=hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension \
  -e HINDSIGHT_API_TENANT_API_KEY="$NOCCIOLO_HINDSIGHT_API_KEY" \
  -e HINDSIGHT_CP_DATAPLANE_API_KEY="$NOCCIOLO_HINDSIGHT_API_KEY" \
  -e HINDSIGHT_CP_ACCESS_KEY="$NOCCIOLO_HINDSIGHT_API_KEY" \
  "$HINDSIGHT_IMAGE"
```

### 7. Verify

Wait ~30-60s for startup and migrations, then:

```bash
curl -sS http://localhost:8888/version
# expect your target api_version

curl -sS -H "Authorization: Bearer $NOCCIOLO_HINDSIGHT_API_KEY" \
  http://localhost:8888/v1/default/banks

docker logs --tail 80 "$HINDSIGHT_CONTAINER"
```

Spot-check recall/reflect on a known bank (Control Plane at `http://localhost:9999`, MCP, or `nocciolo seed --dry-run` against a project that uses that bank).

### After restore or cross-version upgrade

If bank-scoped recall looks slow or thin, upstream recommends repairing per-bank vector indexes:

```bash
docker exec "$HINDSIGHT_CONTAINER" hindsight-admin repair-bank --all --dry-run
docker exec "$HINDSIGHT_CONTAINER" hindsight-admin repair-bank --all
```

(`repair-bank` may not exist on older images; it is on current Admin CLI builds.)

## Rollback

1. `docker rm -f "$HINDSIGHT_CONTAINER"`
2. `docker run` again with the **previous** image tag and the **same** volume + env
3. If the volume was damaged, restore from the backup taken before upgrade (`hindsight-admin restore` is destructive; see [backup docs](./hindsight-bank-backup.md))

## Common mistakes

| Mistake | Result |
|---------|--------|
| Forgetting `-v hindsight-data:/home/hindsight/.pg0` | Empty new database; banks appear “gone” |
| `docker volume rm hindsight-data` | Permanent wipe of all banks |
| Changing tenant API key env without updating clients | `seed` / MCP auth failures |
| Dropping custom LLM env (Ollama URL/model) | Retain `500`s / fact extraction failures |
| Relying on `latest` without recording the old digest | Harder rollback |

## See also

- [hindsight-bank-backup.md](./hindsight-bank-backup.md): full `backup` and per-bank `export-bank`
- [dev-workflow.md](./dev-workflow.md): `nocciolo docker` helper
- [cli-architecture.md](./cli-architecture.md): Docker defaults (`hindsight` / `hindsight-data`)
- [Hindsight Cloud](./hindsight-cloud.md): managed hosting (no local image upgrade)
