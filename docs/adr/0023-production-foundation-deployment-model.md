# ADR 0023: Production Foundation & Deployment Model

## Status

Accepted.

## Context

Every prior version (v0.1–v0.9.1) built and hardened the _engine_ — tenancy,
auth, content, publishing, media. None of them answered the operational
questions a real launch actually needs answered: is the process alive, is
it ready for traffic, how do you migrate a production database, how do you
roll back, how do you back up, how do you deploy at all. v1.0 closes that
gap without adding a single product feature — see docs/ROADMAP.md's v1.0
entry for the explicit "out of scope" list.

Per the mission's own principle: _"réduire concrètement l'écart entre une
application qui fonctionne et une application que l'on peut exploiter,
diagnostiquer, sauvegarder, restaurer et mettre à jour sans improvisation"_
— simplicity and honesty over infrastructure that looks impressive.

## Decision 1 — three independently deployable Node processes, no new infra class

`apps/web`, `apps/admin`, `apps/worker` remain exactly what ADR 0001 already
established: three separate `apps/*` processes, each with its own
`build`/`start`. v1.0 does not introduce Kubernetes, Terraform, Redis,
OpenTelemetry, Sentry, Datadog, or Vault — none of them is required by
anything this engine actually does today (brief §45: "production-ready
without prematurely complex infrastructure"). PostgreSQL and the
S3-compatible object store remain external, unmanaged-by-this-repo services
— see docs/DEPLOYMENT.md for what runs where.

## Decision 2 — a real bug found in the worker's own build/start pipeline

Auditing "does `apps/worker`'s documented production path actually work"
(rather than assuming ADR 0001's original claim still held) surfaced a real,
previously-undiscovered defect: `pnpm start` (`node dist/index.js`) crashed
immediately with `ERR_MODULE_NOT_FOUND`. `tsc -p tsconfig.json` correctly
compiles the worker's own one file, but the worker imports
`@provence360/observability`, which — like every `packages/*` — ships raw,
extensionless-import TypeScript with no build step of its own (ADR 0001,
"Why packages have no build step"). Plain `node` ESM resolution can't
follow `from "./logger"` without an extension; only `tsx` (which every other
consumer of `packages/*` already uses) can. `apps/worker`'s `start` script
now runs `tsx src/index.ts` — the exact same consumption mode `dev` already
used, just without `--watch`. `build` (`tsc -p tsconfig.json`) remains a
real, valuable step: `turbo run build` still uses it as a genuine
type-checking gate, it's just no longer what actually runs in production.
See docs/ARCHITECTURE.md's updated "Why packages have no build step".

## Decision 3 — one centralized, categorized env validator; startup, not first request

`packages/validation/src/env.ts` already had `loadEnv`/`loadDbEnv`/
`loadMediaEnv` (Zod schemas, fail-fast, no secret ever logged). What was
missing: (a) nothing ran them _eagerly_ — a misconfigured production
process could start and serve its first few requests before hitting the
broken piece; (b) no check existed for a _combination_ of individually-valid
values that's still dangerous (the checked-in dev database credentials,
`ROOT_DOMAIN=localhost`, `MEDIA_STORAGE_PROVIDER=memory` in production).

v1.0 adds `findDangerousProductionConfig()` — pure, synchronous, returns
`{errors, warnings}` — and calls it from a new `instrumentation.ts` in each
Next.js app (Next's own once-per-process, before-any-request hook) and from
the worker's startup, before anything else runs. `errors` calls
`process.exit(1)` after logging `application.startup_failed` /
`worker.startup_failed` — a hard exit, not a re-thrown promise rejection
Next would otherwise catch and leave the HTTP listener up answering every
request with a generic 500 (verified empirically — see docs/DEPLOYMENT.md).

## Decision 4 — one escape hatch, not two

v0.9.1 already had `MEDIA_ALLOW_MEMORY_IN_PRODUCTION`, scoped narrowly to
the admin/web Playwright `webServer` configs (which legitimately run
`NODE_ENV=production` via `next start`, for build-realism, without being a
real deployment). Adding the dev-database-credential check in v1.0 would
have broken that same E2E harness a second time (the harness legitimately
reuses the seeded dev database) if left as a second, independent check.
Rather than invent a second flag, every check in
`findDangerousProductionConfig` defers to the _same_ one: setting
`MEDIA_ALLOW_MEMORY_IN_PRODUCTION=true` downgrades every finding to a
warning (still logged, still auditable), not just the storage one. One
flag, one meaning ("this `NODE_ENV=production` process is the E2E harness,
not a real deployment"), everywhere it's checked.

## Decision 5 — liveness and readiness are two different questions, and readiness is cheap

`/health/live` (both apps) never touches a dependency — a database outage
must never make an orchestrator think the _process_ is unhealthy and
restart-loop it pointlessly. `/health/ready` checks exactly one thing: can
`@provence360/database`'s narrowest-privilege role (`provence360_resolver`)
run `select 1` within a 3-second bound, using its own short-lived
connection (never borrowed from a pooled runtime connection, so a readiness
storm can't itself exhaust the pool it's checking). Object storage is
deliberately _not_ part of readiness: a storage outage breaks media
delivery, not the ability to render a page — see docs/DEPLOYMENT.md. Both
response shapes live in `@provence360/observability` (`buildLivenessBody`/
`buildReadinessBody`) rather than duplicated per app, per the brief's own
"don't introduce a second logging/observability abstraction."

## Decision 6 — Docker via `turbo prune`, not hand-maintained per-app Dockerfiles

Given three separately deployable apps sharing a `pnpm` workspace, `turbo
prune --docker` (Turborepo's own purpose-built tool for exactly this) is
the standard, low-maintenance way to produce a minimal per-app dependency
subset before `pnpm install --frozen-lockfile` inside the image — not a
hand-rolled copy-list that silently drifts from the real dependency graph.
See docs/DEPLOYMENT.md for the multi-stage layout, non-root user, and what
stays out of the final image.

## Decision 7 — no CD pipeline yet, stated as a limitation, not simulated

No real cloud target, no real production environment, and no credentials
exist for this repository today. Brief §11/§44 are explicit: never simulate
a deployment and present it as real. v1.0 ships the prerequisites a real CD
pipeline would consume (Docker images that build cleanly, smoke-test
scripts, a documented migration procedure) and stops there — no
`workflow_dispatch` deploy job pointed at nothing, no fabricated success.
This is declared as a limitation in the final report, not hidden.

## Consequences

- A misconfigured production process now fails at boot, loudly, with a
  process exit — not partway through its first requests.
- The worker can actually be deployed as its own container for the first
  time since ADR 0001 claimed it could be.
- `/health/live` and `/health/ready` give an orchestrator (any orchestrator
  — this stays deliberately unopinionated about which one) the two signals
  it actually needs.
- Still true after v1.0, honestly: no real cloud Postgres, no real S3/R2/AWS
  bucket, and no real CD pipeline has been exercised — see the final
  report's LIMITATIONS section.
