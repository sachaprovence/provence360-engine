# Provence360 Engine

A multi-tenant platform that hosts several hundred seasonal-rental sites
from a single technical base. A new client or site is a database row, never
a fork of the code.

This repository currently contains **Foundation v0.3**: the tenancy model,
the security boundary, hostname resolution, real self-hosted
authentication/authorization with a Control Plane (`apps/admin`), and — new
in v0.3 — a real Site Domain (Property/Unit/Amenity/MediaAsset), a Content
Graph (Page + a versioned Block Registry), a closed-token Theme system, and
a shared renderer that turns all of it into HTML for any number of
independently-configured sites. It does not yet contain a booking engine,
a Draft → Release → Publish pipeline, or an AI content generator — see
[docs/ROADMAP.md](docs/ROADMAP.md) for what's deferred and why.

## Core idea

```
Tenant
  └── Site               (public website, presentation + platform config)
       ├── Domain         (hostname bound to the site)
       ├── Property        (a physical place — the Rental domain)
       │    └── Unit        (a separately describable/bookable part of it)
       └── Page            (one URL, an ordered Content Graph of blocks)
            └── Block instance  (hero, text, gallery, ..., or a domain-
                                  bound block referencing a Property/Unit)
```

- **Tenant** — the security and ownership boundary. Everything tenant-scoped carries a `tenant_id`.
- **Site** — a public website belonging to exactly one tenant. A tenant may own several. Never assume 1 Tenant = 1 Site.
- **Domain** — a hostname bound to a site (custom domain or platform subdomain).
- **Property / Unit** — the business/domain data: what's actually for rent. A Property may hold several Units. Never assume 1 Site = 1 logement. See [docs/SITE_DOMAIN.md](docs/SITE_DOMAIN.md).
- **Page / Block** — the presentation/content data: how a Site markets what it has. A Page is a validated, ordered array of typed, versioned block instances — never a per-client React file. See [docs/CONTENT_MODEL.md](docs/CONTENT_MODEL.md) and [docs/BLOCK_SYSTEM.md](docs/BLOCK_SYSTEM.md).
- **Theme** — a shared, closed design-token catalog a Site picks and narrowly overrides — never a per-site fork. See [docs/THEMES.md](docs/THEMES.md).

The public request pipeline:

```
Host -> DomainResolver -> Site -> Page -> Content -> Domain data -> Theme -> Renderer
```

Every step is real as of v0.3 — see [docs/RENDERING.md](docs/RENDERING.md)
for exactly how, including the measured query count on a seeded page. A
Draft → Release → Publish pipeline (freezing a Page's content into an
immutable, versioned snapshot) is the next phase — v0.3 renders the
**live** content of every Page directly; see [docs/ROADMAP.md](docs/ROADMAP.md).

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture,
[docs/MULTI_TENANCY.md](docs/MULTI_TENANCY.md) /
[docs/SECURITY.md](docs/SECURITY.md) for how tenant isolation is actually
enforced (short version: Postgres Row-Level Security plus composite
foreign keys, not application code alone), and
[docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) /
[docs/AUTHORIZATION.md](docs/AUTHORIZATION.md) for how a request becomes a
verified identity and then a tenant-scoped, permission-checked action. The
six new v0.3 documents — [docs/SITE_DOMAIN.md](docs/SITE_DOMAIN.md),
[docs/CONTENT_MODEL.md](docs/CONTENT_MODEL.md),
[docs/BLOCK_SYSTEM.md](docs/BLOCK_SYSTEM.md),
[docs/THEMES.md](docs/THEMES.md),
[docs/RENDERING.md](docs/RENDERING.md), and
[docs/LOCALIZATION.md](docs/LOCALIZATION.md) — cover everything new in
this phase in depth.

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
  sites/          site repository (tenant-scoped): settings + theme selection
  domains/        hostname resolver + domain repository
  auth/           authentication + authorization: password hashing, sessions,
                   permissions, withAuthorizedTenantContext, membership repository
  observability/  structured logger + audit log writer
  validation/     Zod schemas: env vars, hostnames, ids, safe hrefs, slugs
  rentals/        Property/Unit/Amenity domain (packages/rentals)
  content/        Page + Block Registry + versioning + MediaAsset reference repo
  themes/         closed design-token catalog + resolution (base + overrides)
  renderer/       React block renderers + renderBlocks() + resolution pipeline
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
pnpm db:seed                     # 2 tenants, sites, properties/units/pages/themes, users

pnpm dev                         # apps/web on :3000, apps/admin on :3001
```

Visit `http://localhost:3000/` with a `Host` header of
`villas-cassis.provence360.app` (e.g. via `curl -H "Host: villas-cassis.provence360.app" http://localhost:3000/`)
to see "Villa des Oliviers" — a full homepage with a Hero, Gallery,
FeatureList, real Property/Unit data, and an Amenities list — render
through the shared renderer. Repeat with `Host: mas-du-luberon.provence360.app`
to see a genuinely different site (different content, different block
order, a different theme color), rendered by the exact same code.

Visit `http://localhost:3001/login` and sign in as
`alice@provence-sud.test` / `provence360-seed-only-not-a-real-password`
(OWNER of Provence Sud) to see the Control Plane — every seeded user shares
that same published, seed-only password; see
[docs/AUTHENTICATION.md#seed-data](docs/AUTHENTICATION.md#seed-data----never-production-credentials)
and never reuse it anywhere real. From a Site's detail page you can reach
the minimal **Site Editor** (Pages, block editing, Properties, Units,
Amenities, Theme) added in v0.3 — deliberately technical, no drag-and-drop,
enough to validate the model. Every edit is live immediately: v0.3 has no
Draft/Publish step yet (see [docs/ROADMAP.md](docs/ROADMAP.md)).

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
