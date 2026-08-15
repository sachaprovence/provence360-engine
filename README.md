# Provence360 Engine

A multi-tenant platform that hosts several hundred seasonal-rental sites
from a single technical base. A new client or site is a database row, never
a fork of the code.

This repository currently contains **Foundation v0.2**: the tenancy model,
the security boundary, hostname resolution, and — new in v0.2 — real,
self-hosted authentication and tenant-scoped authorization with a minimal
Control Plane (`apps/admin`). It does not yet contain a CMS, theme engine,
booking engine, or any channel integrations — see
[docs/ROADMAP.md](docs/ROADMAP.md) for what's deferred and why.

## Core idea

```
Tenant
  └── Sites
       └── Domains
```

- **Tenant** — the security and ownership boundary. Everything tenant-scoped carries a `tenant_id`.
- **Site** — a public website belonging to exactly one tenant. A tenant may own several.
- **Domain** — a hostname bound to a site (custom domain or platform subdomain).

The public request pipeline:

```
Host -> DomainResolver -> Site -> Tenant -> PublishedRelease -> Renderer
```

(`PublishedRelease` and the real `Renderer` — themes, blocks, content — are
deferred; see the roadmap. Foundation v0.1 resolves all the way through
Tenant and renders a placeholder proving the pipeline is real.)

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture,
[docs/MULTI_TENANCY.md](docs/MULTI_TENANCY.md) /
[docs/SECURITY.md](docs/SECURITY.md) for how tenant isolation is actually
enforced (short version: Postgres Row-Level Security, not application code
alone), and [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) /
[docs/AUTHORIZATION.md](docs/AUTHORIZATION.md) for how a request becomes a
verified identity and then a tenant-scoped, permission-checked action.

## Stack

TypeScript (strict) · pnpm workspaces · Turborepo · Next.js (App Router) ·
PostgreSQL · Drizzle ORM · Postgres RLS · Zod · Vitest · Playwright · Docker

## Repository layout

```
apps/
  web/      public site renderer (Host -> Site -> Tenant resolution)
  admin/    the Control Plane: login, tenant switcher, per-tenant sites/domains/members/audit
  worker/   background job process (placeholder in v0.1 — no jobs yet)

packages/
  database/       Drizzle schema, migrations, RLS policies, DB roles
  tenant/         withTenantContext() — the one way to touch tenant data
  sites/          site repository (tenant-scoped)
  domains/        hostname resolver + domain repository
  auth/           authentication + authorization: password hashing, sessions,
                   permissions, withAuthorizedTenantContext, membership repository
  observability/  structured logger + audit log writer
  validation/     Zod schemas: env vars, hostnames, ids
  testkit/        real-Postgres test database lifecycle + fixture factories
  config/         shared tsconfig/eslint presets
```

## Getting started

Requires Node 22+, pnpm, and Docker (or a local Postgres 16).

```bash
cp .env.example .env
cp .env.test.example .env.test   # only needed to run tests

docker compose up -d             # starts Postgres on localhost:5432

pnpm install
pnpm db:migrate                  # applies schema migrations
pnpm db:setup-roles              # creates the app/resolver/auth DB roles (idempotent)
pnpm db:seed                     # 2 tenants, users, memberships, sites, domains

pnpm dev                         # apps/web on :3000, apps/admin on :3001
```

Visit `http://localhost:3000/` with a `Host` header of
`villas-cassis.provence360.app` (e.g. via `curl -H "Host: villas-cassis.provence360.app" http://localhost:3000/`)
to see a seeded site resolve end to end.

Visit `http://localhost:3001/login` and sign in as
`alice@provence-sud.test` / `provence360-seed-only-not-a-real-password`
(OWNER of Provence Sud) to see the Control Plane — every seeded user shares
that same published, seed-only password; see
[docs/AUTHENTICATION.md#seed-data](docs/AUTHENTICATION.md#seed-data----never-production-credentials)
and never reuse it anywhere real.

### Verifying the whole repo

```bash
pnpm verify
```

Runs, in order: Prettier format check, ESLint, `tsc --noEmit`, the full
Vitest suite (against a real Postgres test database — see
[docs/SECURITY.md](docs/SECURITY.md#how-the-tests-actually-exercise-rls]),
and `next build` for both apps.

End-to-end tests (a real running server, hit with real HTTP requests) are
separate, since they need a seeded dev database and a browser. This
includes `apps/web`'s hostname-resolution smoke tests and `apps/admin`'s
full auth/authorization suite (login, logout, cross-tenant URL tampering,
permission-gated UI, tenant switching — all against real sessions, no
mocked auth):

```bash
pnpm db:migrate && pnpm db:setup-roles && pnpm db:seed
pnpm --filter @provence360/web exec playwright install --with-deps chromium
pnpm test:e2e
```

CI (`.github/workflows/ci.yml`) runs both.

## Why four database connections

`.env.example` defines `DATABASE_URL`, `DATABASE_URL_APP`,
`DATABASE_URL_RESOLVER`, and `DATABASE_URL_AUTH` — four different Postgres
roles with different privileges, not four names for the same thing. This
is the crux of how tenant isolation and identity/authorization are
enforced; see [docs/SECURITY.md](docs/SECURITY.md#the-four-roles).
