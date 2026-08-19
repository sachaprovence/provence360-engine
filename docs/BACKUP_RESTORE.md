# Backup & Restore

v1.0. See [docs/DEPLOYMENT.md](DEPLOYMENT.md) for the surrounding
operational context. This runbook and both scripts below were run for
real, end-to-end, against the local dev database as part of writing them
— not assumed to work. Object storage durability is covered in
docs/DEPLOYMENT.md's "Object storage" section, not here — it's the
provider's responsibility (bucket versioning/lifecycle), not a database
backup concern.

**v1.0.2**: this runbook is provider-neutral and applies to Railway's
managed PostgreSQL unchanged — see [docs/RAILWAY.md](RAILWAY.md), "Backup /
Restore on Railway Postgres" for the one Railway-specific detail (which
connection string to point these scripts at) and an honest statement of
what was and wasn't executed against a real Railway database this release.

## What's backed up

**PostgreSQL only.** A `pg_dump --format=custom` of the whole database —
schema, every tenant's rows, RLS policies, the four roles' grants. Object
storage (media bytes) is not duplicated by this repository — see
docs/DEPLOYMENT.md, "Durability & backup responsibility" for why.

## Backup

```
DATABASE_URL="postgresql://<schema-owning-role>:...@host:5432/dbname" \
  ./scripts/backup-db.sh [output-dir]   # defaults to ./backups
```

Produces one timestamped `.dump` file (custom format — supports
`pg_restore`'s parallel/selective restore, unlike a plain-SQL dump). The
script verifies the dump is readable (`pg_restore --list`) immediately
after writing it — a backup that can't even be listed is worse than no
backup, because it creates false confidence.

Run this **before every deploy that includes a migration** (see
docs/DEPLOYMENT.md, "Runbook" — "Normal deployment"), and on whatever
recurring schedule your actual production database warrants (this repo
doesn't prescribe a schedule — that's an operational decision tied to your
real data's change rate and your provider's own backup capabilities, which
may already cover this at the infrastructure level; check before assuming
you need this script to be your _only_ backup mechanism).

## Restore

```
./scripts/restore-db.sh \
  --target-url="postgresql://<schema-owning-role>:...@host:5432/dbname" \
  --dump=./backups/provence360-<timestamp>.dump \
  --confirm=<database-name>
```

**Deliberately destructive and deliberately hard to run by accident:**

- No default target, no default dump file — both required, always.
- `--confirm` must match the target URL's own database name exactly, or
  the script refuses before touching anything.
- Even with a matching `--confirm`, the script prompts once more,
  interactively, asking the operator to type the database name a second
  time — so a copy-pasted command from the wrong runbook/terminal/shell
  history entry still gets one more chance to be caught before it runs.
- `pg_restore --clean --if-exists` — drops and recreates every object the
  dump contains; anything in the target database _not_ in the dump is left
  alone (this is a schema/data restore, not a "make the database exactly
  equal to the dump and nothing else" wipe).

### Multi-tenant precautions

A restore replaces **every tenant's** data at once — there is no
per-tenant restore in this version (the dump is whole-database). Before
restoring into a database serving live traffic:

1. Take the database out of rotation (stop `apps/web`/`apps/admin`, or at
   minimum accept a window of inconsistency).
2. Confirm which backup you're restoring — a restore moves every tenant
   backward in time together, including tenants who didn't need it.
3. After restore, run the post-restore validation below before bringing
   traffic back.

### Secrets

The dump itself contains `users.password_hash` (already an argon2id hash,
never a plaintext password — see docs/AUTHENTICATION.md) and `sessions`
rows (only a SHA-256 hash of each session token, never the raw token
itself — see ADR 0007). Treat a `.dump` file as sensitive regardless: it's
a full copy of every tenant's real content and metadata. Never commit one
to git, never attach one to an issue/PR, store it wherever your actual
backup retention policy says to.

### Post-restore validation

```
psql "$TARGET_URL" -c "select count(*) from tenants;"
psql "$TARGET_URL" -c "select count(*) from sites;"
psql "$TARGET_URL" -c "select count(*) from site_publications;"
```

Compare against what you expect for the backup's timestamp. Then run
`pnpm db:setup-roles` against the restored database — a `pg_restore` with
`--no-owner --no-privileges` (as `backup-db.sh` produces) does not restore
the four roles' `GRANT`s, since those are applied by `setup-roles.ts`, not
captured by `pg_dump`'s own output for that reason. Skipping this step
leaves the four application roles present (they're not dropped) but
without their column-level `GRANT`s — every request-serving connection
would then fail with a permission error rather than silently seeing the
wrong data; a real, fail-closed consequence of forgetting this step, not
a silent one.

## Verified

Both scripts above were run end-to-end against this repository's local dev
database while writing this document: `backup-db.sh` against
`provence360_dev`, `restore-db.sh` (including its safety-guard rejection
path with a deliberately wrong `--confirm`) into a fresh scratch database,
with post-restore row counts (`tenants`/`sites`/`pages`) confirmed
identical to the source. **Not verified**: restore into a database with
concurrent traffic, restore across major PostgreSQL versions, or restore
of a multi-gigabyte production-sized dump (this repo's dev database is
small — timing/locking behavior at real production scale is not
demonstrated here).
