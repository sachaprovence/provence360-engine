# Railway + Cloudflare R2 — First Real Deployment

v1.0.2 — First Real Deployment. This document is Railway/R2-specific
operational detail; it does not repeat what [docs/DEPLOYMENT.md](DEPLOYMENT.md)
already says in provider-neutral terms (health checks, environments,
containerization, object storage adapter, rollback principles, CI/CD
posture) — read that document first. This one exists because "how do the
four Postgres roles actually get created on Railway's one managed
database" and "how do I create the first tenant without `db:seed`" are
genuinely Railway/production-specific questions with concrete, copy-pasteable
answers, not abstract ones.

No architecture changes ship with this release. Every script referenced
below already existed before this document, except
`db:bootstrap-production` and `db:verify-roles` (both new, both covered in
their own sections).

## Services

Four Railway services in one project:

| Service              | Source                                  | Config                                                     |
| -------------------- | --------------------------------------- | ---------------------------------------------------------- |
| `postgres`           | Railway's own managed PostgreSQL plugin | provisioned from the Railway dashboard, not from this repo |
| `provence360-web`    | this repo, `apps/web/Dockerfile`        | `apps/web/railway.json`                                    |
| `provence360-admin`  | this repo, `apps/admin/Dockerfile`      | `apps/admin/railway.json`                                  |
| `provence360-worker` | this repo, `apps/worker/Dockerfile`     | `apps/worker/railway.json`                                 |

Each `railway.json` is intentionally small — `build.dockerfilePath` (so
Railway builds the real Dockerfile, not a Railway-specific Nixpacks/buildpack
guess) and `deploy.healthcheckPath`/`restartPolicyType` (so those two
operational facts are version-controlled, reviewable, and don't silently
drift if someone changes them in the dashboard without a paper trail). No
declarative Railway file expresses the four database roles, the R2
credentials, or any other environment variable — those are genuinely
per-service secrets and belong in Railway's own Variables UI (or `railway
variables set`), never committed to this repo. This is the "if a declarative
file adds real value, add it; otherwise don't" line from the brief — three
tiny files that make the build/health/restart contract explicit earn their
keep; a file trying to also express secrets would just be a worse, insecure
copy of Railway's own Variables store.

**Per-service dashboard step, one time, per service**: point each service's
"Config-as-code path" (Settings → Config-as-code) at its own `railway.json`
— Railway looks for `railway.json` at the repo root by default and does not
guess a per-service path in a monorepo on its own. Also set each service's
**Root Directory to the repo root** (not `apps/web` etc.) — every Dockerfile
here does `COPY . .` from the monorepo root (see each Dockerfile's own
`turbo prune` comment for why), so the build context has to be the whole
repo, not the app subdirectory.

## SUJET B/C — PostgreSQL: the four roles, for real, on Railway

Railway's Postgres plugin gives you exactly **one** connection string (its
own superuser/owner role — Railway typically names it after the database,
e.g. `postgres`). Everything past that point is this repo's own
`db:setup-roles`/`db:migrate` machinery, unchanged from local dev — Railway
does not need to know these four roles exist; Postgres does.

### What `DATABASE_URL` is, on Railway

The connection string Railway's dashboard shows you for the `postgres`
service, verbatim. This is the schema-owning, RLS-bypassing role — used
**only** for `db:migrate`/`db:setup-roles`/`db:bootstrap-production`, never
by `apps/web`/`apps/admin`/`apps/worker`. See docs/SECURITY.md, "The four
roles."

### What `DATABASE_URL_APP`/`_RESOLVER`/`_AUTH` are, on Railway

The **usernames are not a free choice** — `provence360_app`,
`provence360_resolver`, `provence360_auth` are hardcoded literals baked into
every RLS policy via `packages/database/migrations/*.sql`
(`pgPolicy(..., to: appRole)` in `schema.ts`, where `appRole =
pgRole("provence360_app").existing()`). Using a different username would
mean the RLS policies `db:migrate` creates reference a role that isn't the
one your app actually connects as — a silent, total RLS bypass-by-omission
(the role would simply not match any policy's `to:` clause, and depending on
the query, either see nothing or hit a GRANT-level permission error,
neither of which is "the row-level security you intended").

The **passwords are yours to choose** — generate three strong, independent
random passwords (`openssl rand -base64 32` or Railway's own "Generate"
button on a variable). `db:setup-roles` reads the username/password from
each of these three connection strings and does `CREATE ROLE ... LOGIN
PASSWORD ...` (idempotently — re-running updates the password rather than
erroring; see `packages/database/src/admin/roles.ts`) — it does not invent
credentials itself.

So the four connection strings, using Railway's own host/port/database name
for all four (only the username/password differ):

```
DATABASE_URL="postgresql://<railway-owner-user>:<railway-owner-password>@<railway-host>:<port>/<railway-db>"
DATABASE_URL_APP="postgresql://provence360_app:<your-generated-password-1>@<railway-host>:<port>/<railway-db>"
DATABASE_URL_RESOLVER="postgresql://provence360_resolver:<your-generated-password-2>@<railway-host>:<port>/<railway-db>"
DATABASE_URL_AUTH="postgresql://provence360_auth:<your-generated-password-3>@<railway-host>:<port>/<railway-db>"
```

### SSL/TLS

This codebase's Postgres client (`postgres` — the `postgres.js` driver, see
`packages/database/src/client-*.ts`) takes its SSL behavior entirely from
the connection string's own `sslmode`/`ssl` query parameter — no code change
is needed either way. Railway's **private network** (services in the same
project talking to each other over Railway's internal DNS, which is what
every deployed `apps/*` service should use for `DATABASE_URL_*`) does not
require TLS. If you ever connect over Railway's **public** TCP proxy
endpoint instead (e.g. running a one-off migration from a laptop, not from
`railway run`), append `?sslmode=require` to that connection string. Confirm
which one your migration step is actually using — the answer differs by
whether it runs _inside_ Railway (`railway run`, see below) or _outside_ it.

### Where do `db:migrate`/`db:setup-roles` actually run?

**Not** inside any service's `deploy.startCommand` — brief §6 is explicit
that an implicit per-replica migration is worse than an explicit step, and
Railway has no first-class "release phase" primitive (unlike some other
PaaS's). The reproducible, explicit mechanism this repo already has and
Railway already supports natively:

```
railway link                      # once, to select the right project/environment
railway run --service provence360-admin \
  pnpm db:migrate && \
railway run --service provence360-admin \
  pnpm db:setup-roles
```

`railway run <command>` executes `<command>` with that service's real
environment variables injected, as a one-off process — it does not deploy
anything, and it exits when the command exits. Any already-deployed service
works for this (its container image already has `pnpm`/`tsx` and this
repo's code); `provence360-admin` is a reasonable default since it's the one
service whose environment already includes `DATABASE_URL_AUTH` too, should a
future migration script ever need it. Two people running this
simultaneously would race (Drizzle's own `__drizzle_migrations` tracking
table make a _second_ run a safe no-op once the first completes — but the
two could still both be applying the _same_ not-yet-applied migration at
the same moment); treat this the same as any other production migration
step and don't run it concurrently from two terminals.

**Never** run `db:seed`/`db:publish-seed` this way — `assertSeedSafeTarget()`
(`packages/database/src/seed-safety.ts`) refuses unconditionally the moment
it sees `NODE_ENV=production` (which every deployed Railway service should
have set), before opening any connection for a write. See docs/DEPLOYMENT.md,
"Migrations" for the full guard behavior and its own test matrix.

### SUJET B — verifying the roles actually work: `pnpm db:verify-roles`

New this release (`packages/database/src/scripts/verify-roles.ts`): connects
as all four roles simultaneously and asserts, with real queries against a
real database (no static inspection):

- each of the four connection strings really authenticates as the role its
  name implies (`select current_user`);
- `provence360_app` sees **zero** rows from `tenants` when no
  `app.tenant_id` is set (proves RLS is actually enforced for that role, not
  just declared) and **cannot** select `users.password_hash` (column-level
  grant working);
- `provence360_resolver` can read `domains`/`sites`' routing columns but
  gets a real `permission denied` selecting from `users` or `memberships`
  (no excess privilege);
- `provence360_auth` can read `users.password_hash` (it needs to, for
  login) and `sessions`, but gets `permission denied` on `sites`/`domains`
  (out of its scope);
- the schema-owning role's identity is distinct from all three others.

Run this against Railway right after `db:setup-roles`, before ever deploying
`apps/web`/`apps/admin`/`apps/worker` against that database:

```
railway run --service provence360-admin pnpm db:verify-roles
```

Exits non-zero the moment any check fails — never treat "some checks
passed" as "the roles are fine." This session ran it for real against the
local dev database (14/14 checks passed) as proof the mechanism itself is
correct; see this release's final report, POSTGRESQL & RÔLES, for the exact
output. It could not be run against a real Railway database in this
environment — no Railway credentials exist here (see LIMITES / ACTIONS
MANUELLES RESTANTES in that same report).

## SUJET D — Cloudflare R2

No new adapter — `packages/media`'s `S3ObjectStorage` (v0.9) already speaks
any genuinely S3-compatible API, and R2 is one (see docs/MEDIA.md). Create a
bucket and a scoped API token in the Cloudflare dashboard (R2 → Manage R2
API Tokens — grant it access to **only** the one bucket this deployment
uses, not account-wide), then set on both `provence360-web` and
`provence360-admin` (never on `provence360-worker` — it touches no storage,
see "What runs where" in docs/DEPLOYMENT.md):

```
MEDIA_STORAGE_PROVIDER=s3
S3_REGION=auto
S3_BUCKET=<your-bucket-name>
S3_ACCESS_KEY_ID=<r2-token-access-key-id>
S3_SECRET_ACCESS_KEY=<r2-token-secret>
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

`S3_FORCE_PATH_STYLE` — **leave unset**. v1.0.1 made this default to `true`
automatically the instant `S3_ENDPOINT` is set (R2, like every non-AWS
S3-compatible provider, has no real DNS for virtual-hosted-style
`<bucket>.<endpoint>` addressing) — see docs/MEDIA.md. `S3_REGION=auto` is
R2's own documented convention, not an AWS region; the SDK never validates
it against a real AWS region list, so this is harmless. The `connectionTimeout`/
`requestTimeout` v1.0.1 added to `S3ObjectStorage` (5s/30s) apply here
unchanged — a real network problem between a Railway service and R2 now
fails within a bounded window instead of hanging, same as it does against
any other S3-compatible endpoint.

### Validating real R2 credentials

```
railway run --service provence360-web pnpm --filter @provence360/media run smoke:storage
```

Real put → get → list → delete → cleanup against the actual bucket, using a
key prefixed `__smoke_test__/` so it can never collide with a real upload
(see `packages/media/src/scripts/smoke-storage.ts`). Fails loudly, never
prints the secret access key. **Not run in this session** — no R2
credentials exist in this development environment; see LIMITES in the final
report.

## SUJET E — Per-process environment variables (Railway service Variables)

Unchanged from v1.0.1's `loadWebEnv()`/`loadAdminEnv()`/`loadWorkerEnv()`
(`packages/validation/src/env.ts`) — no schema change was needed for
Railway, because those schemas were never provider-specific. Set these as
each Railway service's own Variables (Settings → Variables), not shared
across services:

**provence360-web**

```
NODE_ENV=production
ROOT_DOMAIN=<see "Domains" below>
DATABASE_URL_APP=...
DATABASE_URL_RESOLVER=...
MEDIA_STORAGE_PROVIDER=s3
S3_REGION=auto
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=...
```

**provence360-admin** — everything web has, plus `DATABASE_URL_AUTH`.

**provence360-worker** — `NODE_ENV=production` only. Do **not** add
`DATABASE_URL*`/`S3_*` "just in case" — the worker's own `loadWorkerEnv()`
doesn't accept them, and `findDangerousProductionConfig()`'s worker-shaped
check has nothing to flag today precisely because the worker consumes none
of these values (see docs/DEPLOYMENT.md, "Configuration & production
guard-rails"). Giving it credentials it never reads is not a safety net, it
is a bigger blast radius if the worker's image is ever compromised.

**Never** set `DATABASE_URL` (the schema-owning role) on any of the three
deployed services — it belongs only in the one-off `railway run` migration
step's own context, which reads it from that service's own Variables at
invocation time; putting it on a long-running service's Variables would
mean every request-serving process carries the one credential capable of
bypassing RLS entirely, for no operational benefit.

**Never** set `MEDIA_ALLOW_MEMORY_IN_PRODUCTION` on any Railway service —
see docs/DEPLOYMENT.md; it exists only for this repo's own Playwright
`webServer` configs.

## SUJET H — Bootstrap the first tenant/owner/site: `pnpm db:bootstrap-production`

New this release (`packages/database/src/scripts/bootstrap-production.ts`).
`db:seed` remains permanently forbidden in production (`assertSeedSafeTarget()`)
— it is dev/test fixture data with a published, non-secret password, never
appropriate for a real deployment. But a brand-new production database
genuinely has no way to create its first real owner, since `apps/admin` has
no self-service signup (login only — see docs/AUTHENTICATION.md). This
script is the minimal, explicit answer: one owner, one tenant, one site, one
domain, created from operator-supplied values, never a default.

```
railway run --service provence360-admin \
  env \
  BOOTSTRAP_OWNER_EMAIL="you@yourcompany.com" \
  BOOTSTRAP_OWNER_NAME="Your Name" \
  BOOTSTRAP_OWNER_PASSWORD="<a real, unique password you will remember — min. 12 chars>" \
  BOOTSTRAP_TENANT_SLUG="your-tenant" \
  BOOTSTRAP_TENANT_NAME="Your Company" \
  BOOTSTRAP_SITE_SLUG="your-site" \
  BOOTSTRAP_SITE_NAME="Your Site" \
  BOOTSTRAP_DOMAIN_HOSTNAME="provence360-web-production.up.railway.app" \
  pnpm db:bootstrap-production
```

(`BOOTSTRAP_DOMAIN_HOSTNAME` should be `provence360-web`'s own Railway
public domain — see "Domains" below for why this alone is enough to make a
site reachable, no wildcard/subdomain configuration required.)

**Guarantees, verified for real against a live Postgres database in this
session** (see this release's final report, BOOTSTRAP PRODUCTION, for the
exact commands and output):

- idempotent by tenant slug — re-running with the same
  `BOOTSTRAP_TENANT_SLUG` is a safe no-op, not a duplicate or a crash;
- refuses (exit 1, before touching the database) if any required variable
  is missing, or if the password is under 12 characters;
- never logs the password, on success or failure;
- there is still **no self-service password reset** (a pre-existing,
  documented gap — see docs/AUTHENTICATION.md#passwords) — the password
  given here is the only one that will work for this owner until an
  operator with direct database access clears `password_hash` by hand.
  Store it in a real secret manager.

After it completes: log in to `provence360-admin`'s URL with that
email/password, create a Page, publish it (see docs/PUBLISHING.md) — the
site's `domains` row already points `BOOTSTRAP_DOMAIN_HOSTNAME` at it, so
the public Railway URL for `provence360-web` will serve it immediately once
published, no further configuration.

## SUJET F/I — Domains

### Phase 1 — Railway's own domains, no configuration needed

`packages/domains`' resolver (`resolveSiteByHostname`,
`packages/domains/src/resolver.ts`) looks up the literal `Host` header
against the `domains` table — there is no code path that computes
`<slug>.ROOT_DOMAIN` dynamically; every reachable hostname, including a
site's own "subdomain," is an explicit row (see `packages/database/src/scripts/seed.ts`'s
own seed data for the existing precedent: `villas-cassis.provence360.app`
is a literal seeded row, not derived from `ROOT_DOMAIN` at request time).
This means Railway's own auto-assigned `*.up.railway.app` domain for
`provence360-web` needs **zero code changes or bypasses** to work — it's
just another hostname, and `db:bootstrap-production`'s
`BOOTSTRAP_DOMAIN_HOSTNAME` (or the admin UI's own "Domains" page —
`apps/admin/app/admin/tenants/[tenantId]/sites/[siteId]/domains/`) inserts
it as a normal row like any custom domain would be. This is fully compatible
with custom domains later — nothing about Phase 1 needs to be undone for
Phase 2, a new `domains` row is simply added alongside it.

`ROOT_DOMAIN` itself is validated at startup (`rootDomainSchema`) and read
by the Playwright E2E configs, but is not consumed by the hostname
resolution path — set it to your real eventual root domain
(`provence360.fr`) from day one; it costs nothing today and avoids
forgetting to set it correctly later.

### Phase 2 — `provence360.fr` (or whichever domain is ultimately chosen)

Prepared here, not executed — no domain was purchased and no DNS was
touched in this session (brief §22/§25's own constraint).

- **Public site** — `provence360.fr` → CNAME (or Railway's documented A/ALIAS
  equivalent for an apex domain) to `provence360-web`'s Railway-provided
  target, added as a Custom Domain in that service's Settings → Networking.
  Railway issues and renews the TLS certificate for it automatically — this
  application never terminates TLS itself (see docs/DEPLOYMENT.md,
  "Domains & TLS").
- **Admin** — `admin.provence360.fr` → CNAME to `provence360-admin`'s
  Railway target, same Custom Domain flow.
- **Per-tenant custom domains** (`*.provence360.fr` wildcard, or a customer's
  own domain like `villa-cassis-en-provence.com`) — each is added the exact
  same way this repo's `domains` table already models it today: one
  `domains` row per hostname (via the admin UI's Domains page, unchanged),
  and one Railway Custom Domain entry pointed at `provence360-web` for that
  same hostname. A `*.provence360.fr` wildcard Custom Domain in Railway
  (if/when tenant subdomains under the root domain become the norm) removes
  the need to add a Railway-side entry per tenant, while the `domains` table
  row is still required per tenant either way (that's the authorization
  check — Railway only decides where traffic for a hostname lands, this
  repo's own resolver still decides which tenant, if any, owns it).
- **`ROOT_DOMAIN`** — set to `provence360.fr` on `provence360-web`/`provence360-admin`
  once that domain exists; no resolver code depends on this value changing
  correctly, only the validated-but-currently-decorative `rootDomainSchema`
  check and the Playwright configs.

## SUJET G — Admin behind Railway's reverse proxy

Audited, no code change needed — every mechanism the brief flagged as a
risk was already either correct for a reverse-proxy deployment or
irrelevant to Railway specifically:

- **Cookies** (`apps/admin/lib/session-cookie.ts`) — `secure:
process.env.NODE_ENV === "production"`, `sameSite: "lax"`, `httpOnly:
true`. Railway terminates TLS at its own edge and the container only ever
  sees plain HTTP from Railway's internal proxy — this is the same "TLS
  terminates upstream, the app itself stays HTTP" model docs/DEPLOYMENT.md's
  "Domains & TLS" section already documents as the expected deployment
  shape, not something Railway does differently. `NODE_ENV=production` on
  every deployed service (see SUJET E above) is what makes `secure: true`
  actually take effect — a browser talking to `https://admin.provence360.fr`
  will send and accept this cookie normally.
- **Host header trust** — `packages/domains/src/resolver.ts` reads the
  literal `Host` header, never `X-Forwarded-Host` (see docs/DEPLOYMENT.md,
  "Domains & TLS," and docs/SECURITY.md). Railway's own edge, like every
  reverse proxy that terminates a custom domain, forwards the genuine public
  hostname as `Host` — confirmed by Railway's own documented behavior
  (custom domain routing at their edge is itself Host-header-based, so it
  has to preserve it correctly to route at all). No change needed, no
  Railway-specific header-trust exception was added.
- **CSP** (`apps/admin/next.config.mjs`'s `headers()`) — unchanged by this
  release; nothing about Railway's proxy relaxes or requires relaxing it.
- **No reverse-proxy-specific admin bug was reproduced** — there is nothing
  to fix here beyond what's already documented above; this section
  documents the audit's conclusion, not a change.

## SUJET J — Health checks

`apps/web/railway.json` and `apps/admin/railway.json` set
`deploy.healthcheckPath: "/health/live"` — deliberately **liveness**, not
readiness (see docs/DEPLOYMENT.md, "Health checks," for the distinction this
release does not change: `/health/live` never touches the database,
`/health/ready` does, via the narrowest-privilege `resolver` role). Railway
uses this path to decide when a new deployment is ready to receive traffic
and to detect a hung/crashed container for its restart policy
(`restartPolicyType: "ON_FAILURE"`, `restartPolicyMaxRetries: 10`) — using
readiness here would mean a genuine, isolated database blip takes the whole
service out of rotation, which is exactly the disproportionate response
docs/DEPLOYMENT.md already argues against for object storage and applies
here too.

`apps/worker/railway.json` sets **no** `healthcheckPath` — the worker is not
an HTTP server (see ADR 0023, Decision 2) and this release does not add a
fake one just to have a Railway health check; Railway falls back to
process-liveness (is the container's PID 1 still running) for a service with
no configured HTTP check, which is the correct signal for a background
process today. `packages/media` isn't touched by readiness either, unchanged
from docs/DEPLOYMENT.md — no new architectural decision here.

## SUJET K — Smoke test after deploying

Minimum, from anywhere with network access to the deployed URLs:

```
node apps/web/scripts/smoke-deployment.mjs --base-url=https://<web-domain>
node apps/admin/scripts/smoke-deployment.mjs --base-url=https://<admin-domain>
```

Both check `/health/live` and `/health/ready`, fail non-zero on any
unexpected status, print nothing but pass/fail per check (see each script's
own source — unchanged from v1.0).

For the full authenticated workflow — login, create a page, publish, and
confirm the public site actually serves the newly-published content — the
new `apps/admin/e2e-remote/remote-smoke.spec.ts` (via
`apps/admin/playwright.remote.config.ts`) drives a real headless browser
against the real deployed admin URL:

```
cd apps/admin
SMOKE_REMOTE_ADMIN_URL=https://<admin-domain> \
SMOKE_REMOTE_PUBLIC_URL=https://<web-domain> \
SMOKE_REMOTE_OWNER_EMAIL="you@yourcompany.com" \
SMOKE_REMOTE_OWNER_PASSWORD="<the password from db:bootstrap-production>" \
SMOKE_REMOTE_TENANT_NAME="Your Company" \
SMOKE_REMOTE_SITE_NAME="Your Site" \
pnpm test:e2e:remote
```

This is genuinely safe to re-run after every redeploy: it creates a fresh,
uniquely-marked **standard** page each run (never touching the site's real
home page after the very first run, which is the one time it needs to
create the home page itself — see the spec file's own comment for exactly
why, and this release's final report, ANOMALIES DÉCOUVERTES, for the real
bug this found: a site can never publish at all until it has an active home
page, which is not obvious from the Publishing page alone unless you read
its own inline validation message). Fails hard, non-zero exit, on any
unexpected response at any step — no step is allowed to silently pass.

Verified in this session against a local `next start` standing in for a
real deployment (three consecutive clean passes, ~4s each, after a real bug
fix — see the final report's SMOKE TESTS section for the exact commands and
output). **Not run against a real Railway URL** — none exists in this
environment.

## SUJET L — Rollback

Extends docs/DEPLOYMENT.md's "Rollback" section with what's Railway-specific:

- **Application rollback** — Railway keeps prior deployments per service;
  use its own "Redeploy" on an earlier deployment (Deployments tab), or
  `railway redeploy <deployment-id>`. Stateless, always safe given the
  additive-migrations rule docs/DEPLOYMENT.md already documents — no
  Railway-specific caveat here.
- **Database** — Railway's managed Postgres has no "rollback" primitive of
  its own beyond point-in-time recovery/backups it may offer at the
  infrastructure level (plan-dependent — check your Railway plan's own
  backup retention before assuming this repo's `backup-db.sh` is your only
  copy). This repo never invents a "down" migration (see docs/DEPLOYMENT.md)
  — the same expand/deploy/contract discipline applies unchanged on Railway.
- **R2 media** — survives an application rollback automatically: nothing
  about rolling back `provence360-web`/`provence360-admin` touches the R2
  bucket, and the application never destructively deletes an object without
  the safe-deletion check (see docs/DEPLOYMENT.md, "Durability & backup
  responsibility").
- **Configuration rollback** — Railway's Variables UI has its own history
  per variable (click a variable → History) — reverting there is the
  Railway-specific mechanism for "go back to the previous known-good
  config" that docs/DEPLOYMENT.md's provider-neutral version doesn't name.
  Never paste a secret value into a support ticket, a commit message, or
  this repo — reference the variable _name_, let Railway's own UI hold the
  value.

## SUJET M — Backup / Restore on Railway Postgres

docs/BACKUP_RESTORE.md's runbook is provider-neutral by design (`pg_dump`/
`pg_restore` against any reachable `DATABASE_URL`) and applies to Railway's
Postgres unchanged — the only Railway-specific fact is _which_ connection
string to point `backup-db.sh`/`restore-db.sh` at (the schema-owning
`DATABASE_URL`, from that service's Variables, or Railway's own public proxy
connection string with `?sslmode=require` if running the scripts from
outside Railway's network — see "SSL/TLS" above).

**Not executed against Railway in this session** — no Railway Postgres
instance exists in this development environment to `pg_dump` from. What
_was_ verified (again, for real, not assumed): the scripts themselves,
end-to-end including the restore script's safety-guard rejection path,
against this session's local dev database — see docs/BACKUP_RESTORE.md's
own "Verified" section, unchanged by this release. The Railway-specific
step this release adds no new tooling for, because none is needed: `railway
run --service provence360-admin -- bash -c 'DATABASE_URL=$DATABASE_URL
./scripts/backup-db.sh'` (or run it from outside Railway against the public
proxy URL) uses the exact same script, unmodified.

## SUJET O — CI/CD: still no automatic deploy-on-push

`.github/workflows/ci.yml` is unchanged in what it _validates_ by this
release (format/lint/typecheck/tests/build/E2E/Docker build/Docker runtime
smoke — see v1.0.1's own final report for how that last one was built and
proven). This release does not add a "deploy to Railway on push to main"
step. Reasoning, per brief §18's own explicit permission to make this call:
a first production deployment target, reached for the first time in this
release, with a bootstrap step that creates real (non-seed) data and a
migration step that is deliberately manual/explicit (see SUJET C above) is
not a good candidate for "every merge to main redeploys it automatically" —
that would either need to skip the migration step (reintroducing the
implicit-migration-at-boot risk brief §6 already rejected) or block every
merge on a human running `railway run pnpm db:migrate` first, which is a
manual gate in a CD pipeline's clothing, not real automation. A manual,
reproducible `railway up` (or the Railway dashboard's own "Deploy" button,
pointed at the commit CI just turned green on) is the honest, correct
posture for this release — see docs/DEPLOYMENT.md's own "CI/CD" section for
the identical reasoning already applied to CD in general.

## SUJET P — Observability on Railway

No new logging platform. Railway's own per-service "Logs" tab already
receives this application's existing structured JSON-lines-to-stdout output
unchanged (`@provence360/observability`'s logger — see docs/DEPLOYMENT.md's
"Runbook," "Incident" for the event names: `application.started`,
`application.startup_failed`, `worker.started`, `worker.shutdown`,
`database.connection_failed`, `health.readiness_failed`, and this release's
own `security.dangerous_production_config` warnings). Nothing in this
codebase logs a password, a full connection string, an S3 secret, or a
session token — confirmed by this release's own SECRETS audit (see the
final report) and unchanged from v1.0's own equivalent audit. Filter
Railway's log view by `level":"error"` or `level":"warn"` for a quick first
look during an incident; no Railway-specific log-drain/export configuration
was added, since none was requested and none is needed for this first
deployment's operational maturity level.

## v1.1 — Populate an empty production site

The production account bootstrap intentionally remains separate from site
content. After `db:bootstrap-production`, run the following once from the
worker service with the same `BOOTSTRAP_*` variables:

```sh
pnpm db:bootstrap-site-content
```

This command creates an active Home page and Contact page only when they do
not exist, fills an existing Home page only when it has no blocks, configures
French site settings and navigation, then publishes through the normal
immutable-revision pipeline. It never overwrites authored page content and
is safe to run again. Remove the temporary `BOOTSTRAP_*` variables after a
successful run. Do not put their values in logs, tickets, commits, or chat.
