# Backing up local Hindsight banks (Docker)

How to back up memory banks on a **local / self-hosted** Hindsight server running in Docker. Upstream: [Admin CLI](https://hindsight.vectorize.io/developer/admin-cli) (`hindsight-admin`).

Nocciolo does not own Hindsight storage. Banks live in the server’s Postgres (embedded `pg0` for the usual Docker setup). Use `hindsight-admin` **inside** the container; it talks to the database directly, not the HTTP API.

## Prerequisites

- Docker running, with your Hindsight container up
- Container name from `nocciolo init` / `.nocciolo/config.json` → `docker.containerName` (default `hindsight`)

Set a helper for the examples below:

```bash
export HINDSIGHT_CONTAINER=hindsight   # or suchconfig-hindsight, etc.
```

Confirm the CLI is present:

```bash
docker exec "$HINDSIGHT_CONTAINER" which hindsight-admin
```

List banks (optional; needs the tenant API key if auth is enabled):

```bash
curl -sS -H "Authorization: Bearer $(docker exec "$HINDSIGHT_CONTAINER" printenv HINDSIGHT_API_TENANT_API_KEY)" \
  http://localhost:8888/v1/default/banks
```

## Choose a backup style

| Command | Scope | Use when |
|---------|--------|----------|
| `hindsight-admin backup` | **Entire** instance (all banks + operational tables) | Before upgrading the Docker image, or a full disaster-recovery snapshot |
| `hindsight-admin export-bank` | **One** bank (portable ZIP) | Backing up or migrating a single project bank |

Both write files **inside** the container. Copy them to the host with `docker cp` afterward.

## Full instance backup

Creates a consistent zip of all Hindsight data in the schema (banks, documents, memories, mental models, directives, webhooks, operational tables). Recommended before an image upgrade (`0.8.x` → `0.9.x`, etc.) while keeping the same named volume.

```bash
BACKUP="hindsight-backup-$(date +%Y%m%d).zip"

docker exec "$HINDSIGHT_CONTAINER" \
  hindsight-admin backup "/tmp/${BACKUP}"

mkdir -p ~/hindsight-bank-backups
docker cp "${HINDSIGHT_CONTAINER}:/tmp/${BACKUP}" ~/hindsight-bank-backups/
```

Restore (destructive — deletes existing data in the target schema first):

```bash
docker cp ~/hindsight-bank-backups/hindsight-backup-YYYYMMDD.zip \
  "${HINDSIGHT_CONTAINER}:/tmp/hindsight-backup.zip"

docker exec -it "$HINDSIGHT_CONTAINER" \
  hindsight-admin restore /tmp/hindsight-backup.zip
```

## Per-bank export

Exports one bank to a portable ZIP: documents, facts, observations, bank config, mental models, directives, and webhooks. Embeddings are **not** included; they are regenerated on `import-bank`. Safe to run against a live instance.

Replace `BANK_ID` with your bank id (often the same as `.nocciolo/config.json` → `bankId`):

```bash
BANK_ID=nocciolo
OUT="/tmp/${BANK_ID}.zip"

docker exec "$HINDSIGHT_CONTAINER" \
  hindsight-admin export-bank --bank "$BANK_ID" --output "$OUT"

mkdir -p ~/hindsight-bank-backups
docker cp "${HINDSIGHT_CONTAINER}:${OUT}" ~/hindsight-bank-backups/
```

Optional: include operational history (`audit_log`, `llm_requests`):

```bash
docker exec "$HINDSIGHT_CONTAINER" \
  hindsight-admin export-bank --bank "$BANK_ID" --output "$OUT" --include-history
```

### Several banks, one at a time

```bash
export HINDSIGHT_CONTAINER=hindsight
mkdir -p ~/hindsight-bank-backups

for BANK_ID in bank-a bank-b bank-c; do
  docker exec "$HINDSIGHT_CONTAINER" \
    hindsight-admin export-bank --bank "$BANK_ID" --output "/tmp/${BANK_ID}.zip"
  docker cp "${HINDSIGHT_CONTAINER}:/tmp/${BANK_ID}.zip" ~/hindsight-bank-backups/
done
```

Import into an instance (target bank must **not** already exist — delete it first or use `--target-bank`):

```bash
docker cp ~/hindsight-bank-backups/nocciolo.zip \
  "${HINDSIGHT_CONTAINER}:/tmp/nocciolo.zip"

docker exec "$HINDSIGHT_CONTAINER" \
  hindsight-admin import-bank --archive /tmp/nocciolo.zip
```

## Where the files land

| Location | Path |
|----------|------|
| Inside the container | `/tmp/<name>.zip` (or whatever path you pass to `--output` / `backup`) |
| On the host | Whatever destination you give `docker cp` (examples use `~/hindsight-bank-backups/`) |

`docker cp … .` copies into your **current shell directory**. Prefer an explicit host path so backups do not land in a random cwd.

## Volume vs export (upgrade note)

Recreating the container with the **same** named volume (typically `hindsight-data` → `/home/hindsight/.pg0`) keeps banks on disk without an export. That is not a substitute for a portable backup: volume data stays on that machine/Docker engine. Use `backup` / `export-bank` when you want copies you can move, archive, or restore after a wipe.

Do **not** run `docker volume rm` on the data volume unless you intend to delete all banks.

## See also

- [Admin CLI](https://hindsight.vectorize.io/developer/admin-cli) — `backup`, `restore`, `export-bank`, `import-bank`
- [Upgrading Hindsight](./hindsight-upgrade.md) — Docker image upgrade with the same data volume
- [Developer workflow](./dev-workflow.md) — local Docker up / seed loop
- [Hindsight Cloud](./hindsight-cloud.md) — managed hosting (different backup story; not this Docker path)
