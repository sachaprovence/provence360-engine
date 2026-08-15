# Provence360 Engine

A multi-tenant platform that hosts several hundred seasonal-rental sites
from a single technical base. A new client or site is a database row, never
a fork of the code.

This repository currently contains **Foundation v0.1**: the tenancy model,
the security boundary, and the hostname resolution pipeline. It does not
yet contain a CMS, theme engine, booking engine, or any channel
integrations — see [docs/ROADMAP.md](docs/ROADMAP.md) for what's deferred
and why.

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

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture, and
[docs/MULTI_TENANCY.md](docs/MULTI_TENANCY.md) /
[docs/SECURITY.md](docs/SECURITY.md) for how tenant isolation is actually
enforced (short version: Postgres Row-Level Security, not application code
alone).

## Stack

TypeScript (strict) · pnpm workspaces · Turborepo · Next.js (App Router) ·
PostgreSQL · Drizzle ORM · Postgres RLS · Zod · Vitest · Playwright · Docker

## Repository layout

```
apps/
  web/      public site renderer (Host -> Site -> Tenant resolution)
  admin/    internal, unauthenticated-for-now operator dashboard
  worker/   background job process (placeholder in v0.1 — no jobs yet)

packages/
  database/       Drizzle schema, migrations, RLS policies, DB roles
  tenant/         withTenantContext() — the one way to touch tenant data
  sites/          site repository (tenant-scoped)
  domains/        hostname resolver + domain repository
  auth/           role/session types (no login flow yet)
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
pnpm db:setup-roles              # creates the app/resolver DB roles (idempotent)
pnpm db:seed                     # 2 tenants, users, memberships, sites, domains

pnpm dev                         # apps/web on :3000, apps/admin on :3001
```

Visit `http://localhost:3000/` with a `Host` header of
`villas-cassis.provence360.app` (e.g. via `curl -H "Host: villas-cassis.provence360.app" http://localhost:3000/`)
to see a seeded site resolve end to end.

### Verifying the whole repo

```bash
pnpm verify
```

Runs, in order: Prettier format check, ESLint, `tsc --noEmit`, the full
Vitest suite (against a real Postgres test database — see
[docs/SECURITY.md](docs/SECURITY.md#how-the-tests-actually-exercise-rls]),
and `next build` for both apps.

End-to-end tests (a real running server, hit with real HTTP requests) are
separate, since they need a seeded dev database and a browser:

```bash
pnpm db:migrate && pnpm db:setup-roles && pnpm db:seed
pnpm --filter @provence360/web exec playwright install --with-deps chromium
pnpm test:e2e
```

CI (`.github/workflows/ci.yml`) runs both.

## Why three database connections

`.env.example` defines `DATABASE_URL`, `DATABASE_URL_APP`, and
`DATABASE_URL_RESOLVER` — three different Postgres roles with different
privileges, not three names for the same thing. This is the crux of how
tenant isolation is enforced; see
[docs/SECURITY.md](docs/SECURITY.md#the-three-roles).
