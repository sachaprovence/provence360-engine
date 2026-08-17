# Architecture

## Monorepo shape

Turborepo + pnpm workspaces, two kinds of packages:

- `apps/*` — deployable processes (Next.js apps, the worker). Each has its own `build`/`dev`/`start`.
- `packages/*` — plain TypeScript libraries, no build step of their own. They ship raw `.ts` source and are consumed either by `tsx` (scripts, the worker) or transpiled in-place by Next.js (`transpilePackages` in each app's `next.config.mjs`). See [ADR 0001](adr/0001-monorepo.md) for why.

Dependency graph (no cycles):

```
validation, config
        |
     database  (schema, RLS policies, migrations, 4 DB clients)
        |
      tenant    (withTenantContext)
       /   \  \________________________
  domains   sites          observability   rentals
       \   /  \  \              |            |
        \ /    \  \           auth          themes
         \      \  \____________|_____________/
          \      \        content
           \      \___________/
            \             |
             apps/web, apps/admin, apps/worker  <-  renderer
```

`auth` depends on `tenant`, `observability`, `database`, and `validation` —
never the reverse. `apps/admin` is the only app that depends on `auth`;
`apps/web`'s public renderer has no login concept and never will (hostname
resolution stays pre-tenant and anonymous — see [ADR 0005](adr/0005-hostname-site-resolution.md)).

Foundation v0.3 adds four packages, each with a single responsibility
rather than one giant "core":

- **`rentals`** — the Property/Unit/Amenity/MediaAsset* domain (business
  data). Depends on `database`, `tenant`, `observability`, `validation`.
  (*`MediaAsset` repository functions actually live in `content` — see
  below — since Gallery/Hero blocks are its primary consumer.)
- **`content`** — Page + the Block Registry + versioning + the MediaAsset
  reference repository. Depends on `database`, `tenant`, `observability`,
  `validation`. No React — the schema/registry layer is deliberately
  framework-free.
- **`themes`** — the closed design-token catalog + resolution. Depends
  only on `database` (for the platform `themes` table) — the leanest new
  package, since a Theme is pure, small, validated configuration.
- **`renderer`** — the only new package that imports React. Depends on
  `content`, `rentals`, `themes`, `database`, `observability`. This is
  where the two schema-only registries (`content`'s `blockRegistry`,
  framework-free) meet actual React components (`renderer`'s own
  `blockRendererRegistry`) — see [docs/BLOCK_SYSTEM.md](BLOCK_SYSTEM.md)
  for why they're kept as two separate registries rather than one.

`sites` (existing since v0.1) gained a dependency on `themes` in v0.3, for
`updateSiteTheme`'s override validation — still no dependency the other
way.

`testkit` depends on `database` only, and is a `devDependency` of every
package whose tests need real fixtures (`tenant`, `domains`, `sites`,
`observability`) — never the other way around, which is what keeps the
graph acyclic.

## The request pipeline

```
Host -> DomainResolver -> Site -> Published Revision -> requested Page -> Domain data -> Renderer
```

1. **Host** — the incoming request's `Host` header, read in `apps/web/app/[[...slug]]/page.tsx` via `next/headers`.
2. **DomainResolver** (`packages/domains/src/resolver.ts`) — normalizes the hostname and looks it up against `domains`, joined to `sites`, using the narrow `provence360_resolver` Postgres role (no tenant known yet, so this can't go through `withTenantContext`). Returns `{ siteId, tenantId, siteStatus }` or `null`.
3. **Site** — once `tenantId` is known, everything else goes through `withTenantContext(tenantId, ...)` (`packages/tenant`), which opens an RLS-scoped transaction.
4. **Published Revision** (v0.4 — `packages/publishing`'s `getPublishedRevision`) — resolves `sites.published_revision_id` and returns its immutable, runtime-parsed snapshot (`parseSiteSnapshot` — v0.5, see [docs/PUBLISHING.md](PUBLISHING.md)) or `null` if the Site has never been published or the snapshot fails to parse. This is the thing that changed from v0.3: this step used to read the Page's live row directly; it now reads a frozen Revision instead — the live `pages` table is never touched by this pipeline at all.
5. **requested Page** (v0.5) — the URL's slug (any published Page, not only home — `app/[[...slug]]/page.tsx` is an optional catch-all) is looked up inside the Revision's own `pages` array.
6. **Content → Domain data** — `packages/renderer`'s `renderBlocks()` walks the Revision's frozen block array; each domain-bound block (PropertySummary, UnitGrid, Amenities) still loads its own real data from `packages/rentals` through the same tenant-scoped transaction, live — Property/Unit/Amenity data is deliberately never frozen into a Revision (see [docs/SITE_DOMAIN.md#future-release-compatibility](SITE_DOMAIN.md#future-release-compatibility)). Media-referencing blocks (Hero/Gallery) instead resolve from the Revision's own frozen media manifest (v0.5). See [docs/BLOCK_SYSTEM.md](BLOCK_SYSTEM.md).
7. **Renderer** — the same `renderBlocks()`/block-component code for every Site, driven entirely by the Revision's already-resolved theme tokens, content, and (v0.5) resolved navigation/media. See [docs/RENDERING.md](RENDERING.md) for the full contract, including the measured query count on a seeded page.

`packages/publishing` itself sits "above" `content`/`sites`/`themes`/
`rentals`/`renderer` in the dependency graph below (it depends on all of
them; none of them depend on it) — consumed only by `apps/web`, `apps/admin`,
and `packages/testkit`'s own test fixtures, so it is deliberately not one
of the boxes in the diagram, the same way it isn't a "layer" any other
package imports.

The immutable `PublishedRelease` step this document used to describe as
future/non-existent is `packages/publishing`'s Revision, landed in v0.4 —
see [docs/PUBLISHING.md](PUBLISHING.md) and
[ADR 0016](adr/0016-publishing-pointer-and-snapshot-model.md) for the full
model, and [docs/SITE_DOMAIN.md](SITE_DOMAIN.md#future-release-compatibility)
for the v0.3 design that made this addition non-breaking.

Why the DomainResolver can't use `withTenantContext`: that function requires
a `tenantId` _before_ it can run, and resolving the tenant from a hostname
is precisely the step that doesn't have one yet. This is one of two
intentional, reviewed exceptions to "no query without tenant context" — see
[docs/SECURITY.md](SECURITY.md) for how both are still kept narrow
(column-level grants, dedicated Postgres roles).

## The Control Plane request pipeline (`apps/admin`)

```
Cookie -> Session -> Membership -> Authorization -> Tenant Context -> RLS -> Data
```

The second exception to "no query without tenant context": authenticating
a request and checking its Membership both have to happen _before_ a
tenant is known, for the same structural reason hostname resolution does.
`packages/auth`'s `provence360_auth`-backed lookups (`validateSessionToken`,
`getMembership`) fill that gap, and
`withAuthorizedTenantContext(...)` is the single function that chains all
five steps and only then opens the same `withTenantContext` used
everywhere else. See [docs/AUTHENTICATION.md](AUTHENTICATION.md) and
[docs/AUTHORIZATION.md](AUTHORIZATION.md) for the full mechanics.

## Why packages have no build step

`packages/*` are consumed by:

- `tsx` (scripts, `apps/worker`'s `dev`), which runs TypeScript directly;
- Vitest, which transforms TypeScript on the fly;
- Next.js, via `transpilePackages`, which bundles the source itself.

None of these need a compiled `dist/`. Adding one would mean either a
`turbo run build` step before every `dev`/`test` invocation (slower inner
loop, another thing to forget) or a `dist/` that silently goes stale. The
one place a compiled output does make sense is `apps/worker`, which is
meant to run as its own container in production — its `build` script
(`tsc -p tsconfig.json`) is real, not a stub.

## Data model

See [docs/MULTI_TENANCY.md](MULTI_TENANCY.md) for the full model and the
reasoning behind each table, and [docs/SITE_DOMAIN.md](SITE_DOMAIN.md) for
the v0.3 tables specifically. Summary:

| Table            | tenant-scoped?                           | notes                                                                                                                          |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `users`          | no                                       | a global identity; scoping is via `memberships`; carries `password_hash` (nullable), unreachable by the tenant-scoped app role |
| `sessions`       | no                                       | identity-plane, not tenant data; owned entirely by `provence360_auth`                                                          |
| `tenants`        | self (`id`)                              | the boundary itself                                                                                                            |
| `memberships`    | yes                                      | user ↔ tenant ↔ role                                                                                                           |
| `sites`          | yes                                      | a tenant may own several; v0.3 adds theme/locale/navigation/feature config                                                     |
| `domains`        | yes (denormalized)                       | hostname → site; globally unique while active                                                                                  |
| `audit_logs`     | yes, or `NULL` for identity-plane events | append-only — no UPDATE/DELETE policy for any role                                                                             |
| `properties`     | yes                                      | belongs to exactly one Site (composite FK) — v0.3                                                                              |
| `units`          | yes                                      | belongs to exactly one Property (composite FK) — v0.3                                                                          |
| `unit_amenities` | yes                                      | Unit ↔ platform Amenity catalog join — v0.3                                                                                    |
| `media_assets`   | yes                                      | a reference to a stored file, not the file itself — v0.3                                                                       |
| `pages`          | yes                                      | belongs to exactly one Site (composite FK); `content` is a validated JSONB block array — v0.3                                  |
| `themes`         | no (platform catalog)                    | curated, read-only to tenants, same shape as `amenities` — v0.3                                                                |
| `amenities`      | no (platform catalog)                    | governed structured catalog, not free-text — v0.3                                                                              |
