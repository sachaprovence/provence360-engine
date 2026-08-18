# Deployment

v1.0 — Production Foundation & Deployment Readiness. See
[ADR 0023](adr/0023-production-foundation-deployment-model.md) for the
decisions behind everything here, and
[docs/BACKUP_RESTORE.md](BACKUP_RESTORE.md) for the database backup/restore
runbook specifically.

## What runs where

| Process        | Source                           | Serves                                                                               | Needs                                                                                       |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `apps/web`     | `apps/web`                       | the public site (`Host -> DomainResolver -> Site -> Published Revision -> Renderer`) | Postgres (`DATABASE_URL_APP`, `DATABASE_URL_RESOLVER`), object storage                      |
| `apps/admin`   | `apps/admin`                     | the Control Plane (login, editing, publishing, media library)                        | Postgres (`DATABASE_URL_APP`, `DATABASE_URL_RESOLVER`, `DATABASE_URL_AUTH`), object storage |
| `apps/worker`  | `apps/worker`                    | background process boundary — currently a heartbeat only, see docs/ROADMAP.md        | nothing beyond `NODE_ENV` today — no database access yet, see "Configuration" below         |
| PostgreSQL     | external, unmanaged by this repo | the one source of truth, RLS-enforced                                                | —                                                                                           |
| Object storage | external, S3-compatible          | media bytes                                                                          | —                                                                                           |

**v1.0.1** — through v1.0, every process validated the FULL four-role
`dbEnvSchema` regardless of which roles it actually used (`DATABASE_URL`,
the schema-owning/migration role, was required by every deployed process's
environment even though only migration/seed scripts ever dereference it —
and the worker required all four despite using none). Fixed for real, not
just at the startup-validation layer: `packages/database`'s three per-role
pool getters (`client-app.ts`/`client-resolver.ts`/`client-auth.ts`) now
each parse only their own variable too, so a narrower per-process schema
couldn't have been undone by the first real request that touched one of
them. See `packages/validation/src/env.ts`'s `webEnvSchema`/
`adminEnvSchema`/`workerEnvSchema` (built from a real audit of each app's
imports) and this release's final report, PER-PROCESS ENVIRONMENT
VALIDATION, for the full trace.

Nothing here is tied to a specific cloud provider. Any host that can run a
long-lived Node 22 process, reach a Postgres server, and reach an
S3-compatible endpoint works — a VM, a container platform, a PaaS. This
document deliberately does not pick one.

## Environments

Three, explicit, distinguished by `NODE_ENV` plus real configuration
differences — never an inferred or implicit fourth state:

- **development** — `pnpm dev` (Turborepo `--parallel`), `MEDIA_STORAGE_PROVIDER=memory` (the default), the docker-compose Postgres or an equivalent local instance.
- **test** — set by Vitest/`test:db:prepare` automatically; a separate `provence360_test` database (see `docker/postgres-init/01-create-test-db.sql`), never the dev database.
- **production** — `NODE_ENV=production`; `MEDIA_STORAGE_PROVIDER=s3` is _mandatory_ (memory storage refuses to start — see "Configuration & production guard-rails" below); real, non-default database credentials; a real `ROOT_DOMAIN`.

No **staging** environment is defined. It would add real value once a
second real deployment target exists to test against before production —
today there is exactly one deployment target (none, yet), so a staging
environment would be a config permutation with nothing distinct to
validate. Add it the day a second real target exists, not before (brief
§5's own "only if it doesn't need hacks").

## Configuration & production guard-rails

Every process validates **its own** environment **eagerly, at startup** —
`apps/web` and `apps/admin` via `instrumentation.ts` (Next.js's
once-per-process, before-any-request hook), `apps/worker` via the top of
`src/index.ts`. A missing or malformed variable throws immediately.

**v1.0.1** — each process validates only what it actually needs, not a
one-size-fits-all shared schema: `apps/web` uses `loadWebEnv()`,
`apps/admin` uses `loadAdminEnv()`, `apps/worker` uses `loadWorkerEnv()`
(today just `NODE_ENV` — see "What runs where" above). All three are built
from the same shared primitives in `packages/validation/src/env.ts`
(`resolverDbEnvSchema`/`appDbEnvSchema`/`authDbEnvSchema`/
`adminDbEnvSchema`, `nodeEnvSchema`, `rootDomainSchema`) rather than being
three independently hand-written schemas. Migration/seed scripts still use
the full `dbEnvSchema`/`loadDbEnv()` (they genuinely touch every role).

Beyond per-variable shape, `findDangerousProductionConfig()` catches
_combinations_ that are individually valid but still wrong in production:

- `NODE_ENV=production` with the default (memory) media storage — refused, `MediaObjectStorage` is in-process and non-persistent.
- `NODE_ENV=production` with a `DATABASE_URL*` still containing the checked-in dev/CI credentials (`provence360:provence360@`, etc.) — refused, this is never a coincidence.
- `NODE_ENV=production` with `ROOT_DOMAIN=localhost` — refused.

A production process with any of these **exits immediately** (`process.exit(1)`
after logging `application.startup_failed`/`worker.startup_failed`) rather
than starting and serving broken traffic. This was verified empirically,
not assumed: an earlier version of this guard only re-threw the error,
which Next.js caught as an `unhandledRejection` and left the HTTP listener
up, answering every request (including `/health/live`) with a generic 500
— a "serving broken traffic" failure mode, not "not serving at all." The
hard `process.exit(1)` fixes that; a container orchestrator's restart
policy needs the unambiguous signal a dead process gives it.

`MEDIA_ALLOW_MEMORY_IN_PRODUCTION=true` is the **one** deliberate escape
hatch, downgrading every one of the checks above to a loud warning instead
of a fatal error — reserved for the admin/web Playwright `webServer`
configs (which legitimately run `NODE_ENV=production` for build-realism
while reusing the seeded dev database). **Never set this in a real
deployment's own configuration.**

## Health checks

| Route           | Apps       | Checks                                                                                          | Purpose                                                                                                                     |
| --------------- | ---------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `/health/live`  | web, admin | nothing — always `200 {"status":"ok"}`                                                          | "is the process up at all." Never fails because a dependency is down.                                                       |
| `/health/ready` | web, admin | PostgreSQL, via a short-lived connection on the narrowest-privilege (`resolver`) role, 3s bound | "can this instance correctly serve traffic right now." `200` when ok, `503 {"status":"degraded","checks":{...}}` otherwise. |

Deliberately **not** checked by readiness: object storage. A storage
outage breaks media delivery specifically, not the ability to render a
page at all — taking a whole instance out of a load balancer's rotation
over it would be a disproportionate response. Neither route ever returns a
connection string, stack trace, or other internal detail — verified by a
real failure-injection test (stop Postgres, confirm `/health/ready` reports
`{"database":"failed"}` with no leaked detail while `/health/live` stays
`200`; see `packages/database/src/health.test.ts` and the final report's
TESTS section for the exact numbers).

`apps/web` also keeps its pre-v1.0 `/api/health` (used by
`playwright.config.ts`'s `webServer.url`) — same body as `/health/live`,
kept so nothing that already points at it breaks.

## Database

### Connections & pooling

Four roles (`DATABASE_URL`/`_APP`/`_RESOLVER`/`_AUTH`), unchanged from v0.1
— see docs/SECURITY.md. v1.0 adds explicit `connect_timeout`/`idle_timeout`
(10s/60s) to every pool: previously unset, meaning an unreachable database
could hang a request indefinitely instead of failing within a bounded,
predictable window.

### Migrations

```
pnpm db:migrate        # tsx packages/database/src/scripts/migrate.ts — tracked, idempotent (Drizzle's own __drizzle_migrations table; re-running is a no-op, not an error)
pnpm db:setup-roles    # tsx packages/database/src/scripts/setup-roles.ts — (re)applies the four roles' GRANTs; also idempotent
```

Both run against `DATABASE_URL` (the schema-owning, RLS-bypassing role) —
**never** run these against `DATABASE_URL_APP`/`_RESOLVER`/`_AUTH`, which
don't have the privilege and would fail loudly if misused (not silently).

`pnpm db:seed` and `pnpm db:publish-seed` are **development/test fixtures
only** — two demo tenants, seed users with a shared, published,
`docs/AUTHENTICATION.md`-documented non-secret password. **Never run either
against a production database.**

**v1.0.1** — both are now guarded by `assertSeedSafeTarget()`
(`packages/database/src/seed-safety.ts`), called before either script's
first write. `NODE_ENV=production` is refused unconditionally, with no
override. Outside production, the guard requires at least one positive
signal that the target is genuinely a dev/test database: CI detected
(`CI=true`/`CI=1`) or the database name matching this repo's own `_dev`/
`_test` naming convention (`provence360_dev`, `provence360_test`, ...). A
target it cannot positively vouch for is refused the same as a production
one — "ambiguous" is not "probably fine." A refusal happens before any
connection is opened for a write, so it writes nothing — see this
release's final report, SEED SAFETY, for the real, non-simulated
zero-writes verification. `db:migrate` and `db:setup-roles` are
**deliberately not gated** by this guard — production must still be able to
run them (see "Deployment strategy" below).

**The full pipeline differs by target**:

- **Production**: `db:migrate` then `db:setup-roles`. Never `db:seed` or
  `db:publish-seed` — refused by the guard above even if attempted.
- **Development / test / CI**: `db:migrate`, `db:setup-roles`, `db:seed`,
  `db:publish-seed`, in that order (see `.github/workflows/ci.yml`'s
  "Prepare dev database for e2e" step for the exact CI sequence).

Migration failure behavior: `migrate.ts` exits non-zero and logs the real
Postgres error to stderr; nothing about the database is left ambiguous —
either every migration in the tracked table applied, or the script failed
loudly before completing.

Version compatibility: every migration in `packages/database/migrations/`
is additive (new tables/columns/roles) — none of the 19 migrations to date
drops a column or table a running application version depends on. A
migration always deploys _before_ the application version that needs its
new shape (see "Rollback" below for what that implies about revert order).

## Deployment strategy

No existing deployment model was found in the repository before v1.0
(`docker-compose.yml` is a **local Postgres for development only** — it
never ran an app process, and stays that way; see the note in that file's
own history). v1.0 proposes the minimal, portable model implied by "three
independent Node processes + two external services":

1. Build each app's image (see "Containerization" below).
2. Provision PostgreSQL and an S3-compatible bucket (any real provider —
   see "Object storage" below).
3. Run `pnpm db:migrate && pnpm db:setup-roles` against the production
   database, once, before the first deploy of a version that needs new
   schema.
4. Deploy `apps/web`, `apps/admin`, `apps/worker` as three separate,
   independently-scalable processes/containers, each given its own
   environment (see "Configuration" above — same four DB roles, same
   `MEDIA_STORAGE_PROVIDER=s3` block, same `ROOT_DOMAIN`).
5. Point a reverse proxy / load balancer at `apps/web`'s and `apps/admin`'s
   `/health/live` and `/health/ready`.
6. Run the deployment smoke test (see "Smoke tests" below) against the
   newly-deployed instance before considering the deploy complete.

No specific host (AWS/GCP/Azure/Vercel/Fly.io/Railway/Render/Cloudflare)
is mandated — the model above works on any of them.

## Containerization

Multi-stage Dockerfiles exist for all three apps
(`apps/{web,admin,worker}/Dockerfile`), built via `turbo prune --docker` —
Turborepo's own tool for producing a minimal per-app dependency subset from
a `pnpm` workspace, rather than a hand-maintained copy-list that would
silently drift from the real dependency graph. See each Dockerfile's own
comments for the exact stage layout. Summary:

- **`base`** — `node:22-alpine`, `pnpm` via Corepack (matches root `package.json`'s `packageManager` field — one source of truth for the pnpm version).
- **`pruned`** — `turbo prune <app> --docker`, isolating exactly that app's workspace dependency subset.
- **`builder`** — `pnpm install --frozen-lockfile` against the pruned lockfile, then `pnpm --filter <app> build` (Next.js apps) or the worker's real `tsc` type-check.
- **`runner`** — a fresh `node:22-alpine` layer, copies only the build output and production `node_modules` from `builder`, runs as a non-root `node` user (already present in the base image), no dev dependencies, no `.env*` file (`.dockerignore` excludes them explicitly), no source outside what each app's Next.js standalone output or `apps/worker/src`+`tsx` actually needs at runtime.

Web/admin use Next.js's `output: "standalone"` trace-based bundling (added
in v1.0's `next.config.mjs` alongside the existing `transpilePackages`) so
the runtime image doesn't need the full `node_modules` tree. The worker's
runner stage runs `tsx src/index.ts` directly (see ADR 0023, Decision 2 —
`node dist/index.js` cannot resolve `packages/*`'s raw-TypeScript imports;
`tsx` is the same consumption mode every other `packages/*` consumer uses)
— its `CMD` execs `tsx` directly rather than going through `pnpm start`, so
`SIGTERM` reaches the actual Node process as PID 1 instead of being
absorbed by a `pnpm`/`node` wrapper process tree (verified manually — see
the final report's TESTS section).

`sharp` (used by `packages/media` for real image decoding/variant
generation) ships prebuilt `musl` binaries compatible with `node:22-alpine`
— confirmed by the Docker build actually succeeding for `apps/web`/`apps/admin`,
not assumed.

Each Dockerfile has a matching `.dockerignore` excluding `node_modules`,
`.next`, `.git`, every `.env*` file, and test artifacts — no secret is ever
baked into an image layer.

## Object storage

`packages/media`'s `S3ObjectStorage` (v0.9) already supports any genuinely
S3-compatible backend generically — `endpoint`/`region`/`bucket`/
`accessKeyId`/`secretAccessKey`/`forcePathStyle`, no hardcoded provider (see
`.env.example`'s Media section). v1.0 adds nothing new to the adapter
itself; what was missing was a way to _prove_ a given production
configuration actually works before relying on it.

### Storage smoke test

```
pnpm --filter @provence360/media run smoke:storage
```

(`packages/media/src/scripts/smoke-storage.ts`) — put → get → list →
delete against whatever `MEDIA_STORAGE_PROVIDER=s3`-configured bucket is in
the environment, using a key prefixed `__smoke_test__/<timestamp>-<random>`
so it can never collide with or touch a real uploaded asset. Cleans up in
a `finally` regardless of outcome. Fails loudly (non-zero exit, real error
message) if any step fails — including printing which step failed, never
the credentials used.

**v1.0 claimed this had been run against `s3rver` locally to prove the
script itself was correct — that claim was inaccurate.** v1.0.1's own
investigation found it had actually hung on `put` in that manual test; see
this release's final report, STORAGE SMOKE ROOT CAUSE, for the full
mechanism (virtual-hosted-style S3 addressing against a non-AWS endpoint
with no request timeout configured, both now fixed) and reproduction. It
**has now** genuinely been run against a real, separately-running `s3rver`
instance (the same real S3-REST-API test double v0.9.1's integration suite
uses) end to end — put/get/list/delete, real HTTP, real bytes, PASSED — but
still **not** against a real AWS S3, Cloudflare R2, or MinIO bucket, because
no such credentials exist in this environment. Run it yourself against your
actual bucket before a first production deploy:

```
MEDIA_STORAGE_PROVIDER=s3 \
S3_REGION=... S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
[S3_ENDPOINT=...]  # only for a non-AWS endpoint (R2/MinIO); path-style
                    # addressing is now the automatic default whenever this
                    # is set (v1.0.1 — see docs/MEDIA.md)
pnpm --filter @provence360/media run smoke:storage
```

### Durability & backup responsibility

- **This application's responsibility**: never destructively deletes an
  object on suspicion alone (v0.9.1's orphan reconciliation is
  detection-only — see `packages/media/src/reconciliation/orphan-scan.ts`),
  deterministic storage keys (no accumulation of duplicate objects on
  retry), and a safe-deletion check (`isMediaAssetSafeToDelete`) before any
  future delete UI could ever remove a `MediaAsset` still referenced by a
  historical Revision.
- **The S3-compatible provider's responsibility**: durability of stored
  bytes, bucket versioning (if enabled), lifecycle policies, cross-region
  replication. This repository does not implement a second copy of media
  bytes — that would duplicate what every real S3-compatible provider
  already does better, and isn't needed given the application never
  destructively deletes without the safety check above.

## Rollback

Three distinct kinds, deliberately not conflated:

- **Code rollback** — redeploy the previous container image/commit for
  `apps/web`/`apps/admin`/`apps/worker`. Stateless; always safe given the
  migration compatibility rule below.
- **Config rollback** — revert the environment variables to the previous
  known-good set; the startup guard-rails (see "Configuration" above)
  catch an accidentally-wrong revert immediately rather than silently.
- **Database rollback** — **not automatic, and not always possible.** Every
  migration to date is additive (new tables/columns/roles, nothing
  dropped) specifically so that an older application version can keep
  running against a newer schema — the _expand_ half of expand → deploy →
  contract. A migration that ever needs to _drop_ a column/table (the
  _contract_ half) must ship in its own later release, only after every
  application version that reads the old shape has been fully rolled out
  and confirmed — never in the same migration as the code that stops
  needing it. No migration to date has reached the contract phase, so
  reverting to any prior deployed commit against the current schema is
  safe today; this will not automatically remain true forever, and no
  tooling here pretends to auto-generate a "down" migration.

## CI / CD

**CI** (`.github/workflows/ci.yml`) already ran a fresh-database migration
on every push before v1.0 (the "Prepare dev database for e2e" step runs
`db:migrate` against a brand-new `postgres:16-alpine` service container
every single run) — this already substantially satisfies "test migrations
against a fresh database," so v1.0 didn't duplicate it. v1.0 adds one job:
building all three Docker images (no push, no registry, no credentials
required) as a real build-validation gate, catching exactly the kind of
break this mission's own audit found in the worker (see ADR 0023, Decision 2) before it reaches a real deployment attempt.

**CD**: intentionally not added. No real cloud target and no deployment
credentials exist for this repository — a workflow that "deploys" without
either would either fail immediately (uninformative) or, worse, silently
do nothing while claiming success. Brief §11/§29/§44 are explicit: never
simulate a deployment. This is a stated limitation (see the v1.0 final
report), not an oversight — the Docker images and smoke-test scripts this
version adds are exactly the prerequisites a real CD pipeline would need,
the moment a real target exists.

## Domains & TLS

- **Root domain / subdomain routing**: unchanged from v0.1 — `<slug>.ROOT_DOMAIN`
  resolves by subdomain, any other `Host` is looked up as a custom domain
  (`domains` table). See docs/SITE_DOMAIN.md.
- **Host header trust**: `apps/web`'s resolver reads Next.js's own `headers().get("host")`
  — the literal `Host` header, never `x-forwarded-host` or any other
  client-suppliable header. A reverse proxy sitting in front of this
  application **must** forward the genuine public hostname as `Host` (the
  default behavior of essentially every reverse proxy that terminates a
  custom domain) — this application deliberately never trusts a
  `X-Forwarded-*` header for tenant resolution, since nothing here
  guarantees such a header wasn't set by the client itself rather than a
  trusted proxy.
- **TLS**: this application never terminates TLS itself and never
  reimplements ACME/Let's Encrypt — that's the reverse proxy's or hosting
  platform's job (Caddy, nginx, or your platform's own managed TLS). Keep
  that boundary: adding TLS termination inside a Node process here would be
  a second, worse implementation of something already solved upstream.

## Rate limiting & multi-instance safety

**Rate limiting**: login already has DB-backed brute-force mitigation
(`packages/auth/src/rate-limit.ts`, since v0.2) — per-email, windowed,
counted via `audit_logs`, correctly shared across every instance because
it's backed by the database rather than in-process memory (an in-process
counter would silently become `threshold × instance count` the moment more
than one instance runs — see that file's own doc comment). No other
endpoint has dedicated rate limiting today. Rather than bolt on an
in-memory limiter for the rest (which would carry exactly the same
multi-instance flaw the login one was written specifically to avoid — see
brief §25/§26's own instruction not to fake a protection that only works
on one instance), this is documented as a real, known gap for a future
version, once a shared-state mechanism (the database, or a real rate-limit
service) is chosen deliberately rather than reached for by default.

**Multi-instance safety** — audited every place this codebase holds state,
to confirm nothing assumes "one process":

| State                                             | Where                                                                                      | Multi-instance safe?                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions                                          | `sessions` table (Postgres)                                                                | Yes — DB-backed, v0.2                                                                                                                                                                  |
| Login rate limiting                               | `audit_logs` (Postgres)                                                                    | Yes — DB-backed, v0.2                                                                                                                                                                  |
| Row locks (publish/rollback, membership changes)  | `SELECT ... FOR UPDATE` (Postgres)                                                         | Yes — DB-native                                                                                                                                                                        |
| Media upload state                                | `media_uploads` table (Postgres)                                                           | Yes — DB-backed, v0.9                                                                                                                                                                  |
| Object storage                                    | S3-compatible (production) / in-process `Map` (dev/test only, guarded — see docs/MEDIA.md) | Yes in production; the dev/test fallback is explicitly single-instance and blocked from production by the startup guard (see "Configuration" above)                                    |
| `getObjectStorage()`/`getAppDb()` etc. singletons | `globalThis`-memoized, per-process                                                         | Correctly _not_ shared across instances — each process needs its own connection pool / storage client handle; this is the correct scope for that kind of handle, not a correctness gap |
| React `cache()` (`renderPublishedPage`)           | per-request only                                                                           | Not shared state at all — scoped to one request's lifetime                                                                                                                             |
| Configuration                                     | environment variables, loaded per-process at startup                                       | Each instance reads its own — no runtime-mutable shared config exists                                                                                                                  |

No mono-instance limitation was found beyond the two already-documented,
deliberate ones (dev/test object storage, and the absence of rate limiting
beyond login) — both stated above rather than discovered silently later.

## Runbook

### First production deployment

1. Provision PostgreSQL (a real server or managed instance — not the
   `docker-compose.yml` in this repo, which is dev-only).
2. Provision an S3-compatible bucket; run the storage smoke test against
   it (see "Object storage" above) before trusting it.
3. Set each process's own production environment variables — see
   `.env.example`'s Shared/Database/Web & Admin/Worker/Media sections and
   docs/DEPLOYMENT.md's "What runs where" table for exactly which
   `DATABASE_URL*` role(s) each of `apps/web`/`apps/admin`/`apps/worker`
   actually needs (`DATABASE_URL`, the schema-owning role, is for the
   migration step below only — no deployed app process needs it), plus
   `ROOT_DOMAIN`, `NODE_ENV=production`, `MEDIA_STORAGE_PROVIDER=s3` + its
   `S3_*` variables for web/admin. **Never** set
   `MEDIA_ALLOW_MEMORY_IN_PRODUCTION`.
4. Run `pnpm db:migrate && pnpm db:setup-roles` against the production
   database, once.
5. Build and deploy the three container images (or run each app's `build`
   - `start` directly on your chosen host).
6. Confirm `/health/live` and `/health/ready` both return `200` on web and
   admin.
7. Run the deployment smoke test (`pnpm --filter @provence360/web run
smoke:deployment -- --base-url=https://your-domain` — see the script's
   own `--help` for both apps' variants).
8. Create the first real tenant/user through `apps/admin` — **do not** run
   `pnpm db:seed` against production; it's a fixture script, not a
   provisioning tool (see "Migrations" above).

### Normal deployment

1. Confirm CI is green on the commit being deployed.
2. Back up the database if the deploy includes a migration (see
   docs/BACKUP_RESTORE.md).
3. Run `pnpm db:migrate` against production if the deploy includes new
   migrations (safe — see "Rollback" above for why additive migrations
   don't need a deploy-order dance).
4. Deploy the new images.
5. Run the deployment smoke test.
6. Watch `/health/ready` and the structured logs (`application.started`,
   `database.connection_failed`, `health.readiness_failed`) for the first
   few minutes.

### Incident

1. Identify which process (`apps/web`/`apps/admin`/`apps/worker`) is
   affected.
2. Check its structured logs first — every startup/shutdown/readiness
   event listed above, plus per-request errors, are JSON-lines to stdout.
3. Check `/health/live` (is the process even up) then `/health/ready` (is
   its database dependency reachable).
4. If the current deployed version is the cause, roll back the code (see
   "Rollback" above) — do not attempt a live hotfix under incident
   pressure.

### Restoration

See [docs/BACKUP_RESTORE.md](BACKUP_RESTORE.md) — the full runbook,
including the safety guard-rails on the restore script itself.
