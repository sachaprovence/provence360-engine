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
       /   \
  domains   sites          observability
       \   /                     |
        \ /                    auth   (password/session/permissions/
         \                              withAuthorizedTenantContext)
          \                     /
           apps/web, apps/admin, apps/worker
```

`auth` depends on `tenant`, `observability`, `database`, and `validation` —
never the reverse. `apps/admin` is the only app that depends on `auth`;
`apps/web`'s public renderer has no login concept and never will (hostname
resolution stays pre-tenant and anonymous — see [ADR 0005](adr/0005-hostname-site-resolution.md)).

`testkit` depends on `database` only, and is a `devDependency` of every
package whose tests need real fixtures (`tenant`, `domains`, `sites`,
`observability`) — never the other way around, which is what keeps the
graph acyclic.

## The request pipeline

```
Host -> DomainResolver -> Site -> Tenant -> PublishedRelease -> Renderer
```

1. **Host** — the incoming request's `Host` header, read in `apps/web/app/page.tsx` via `next/headers`.
2. **DomainResolver** (`packages/domains/src/resolver.ts`) — normalizes the hostname and looks it up against `domains`, joined to `sites`, using the narrow `provence360_resolver` Postgres role (no tenant known yet, so this can't go through `withTenantContext`). Returns `{ siteId, tenantId, siteStatus }` or `null`.
3. **Site / Tenant** — once `tenantId` is known, everything else goes through `withTenantContext(tenantId, ...)` (`packages/tenant`), which opens an RLS-scoped transaction.
4. **PublishedRelease** — not modeled yet. Foundation v0.1 has no draft/publish workflow (see [ROADMAP](ROADMAP.md)); `apps/web` reads the site's live row directly.
5. **Renderer** — not built yet either (no themes, no blocks). `apps/web`'s page is a placeholder that proves steps 1–4 are real, not stubbed.

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
reasoning behind each table. Summary:

| Table         | tenant-scoped?                           | notes                                                                                                                          |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `users`       | no                                       | a global identity; scoping is via `memberships`; carries `password_hash` (nullable), unreachable by the tenant-scoped app role |
| `sessions`    | no                                       | identity-plane, not tenant data; owned entirely by `provence360_auth`                                                          |
| `tenants`     | self (`id`)                              | the boundary itself                                                                                                            |
| `memberships` | yes                                      | user ↔ tenant ↔ role                                                                                                           |
| `sites`       | yes                                      | a tenant may own several                                                                                                       |
| `domains`     | yes (denormalized)                       | hostname → site; globally unique while active                                                                                  |
| `audit_logs`  | yes, or `NULL` for identity-plane events | append-only — no UPDATE/DELETE policy for any role                                                                             |
