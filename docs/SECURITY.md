# Security

## Threat model for this phase

The property this Foundation exists to guarantee: **Tenant A can never
read, modify, or delete Tenant B's data — even if Tenant A's code has a
bug, even if it knows Tenant B's UUIDs outright.** Everything below is in
service of that one sentence.

Foundation v0.1 has no login flow yet (see [ROADMAP.md](ROADMAP.md)), so
today the property is proven at the data-access layer, exercised directly
by tests, rather than through an authenticated HTTP request. That's
deliberate: the isolation guarantee has to hold at the database layer
regardless of what gets built on top of it later.

## Defense in depth

Four independent layers, each capable of stopping a cross-tenant read on
its own:

1. **Application context** (`packages/tenant/src/context.ts`) — an
   `AsyncLocalStorage`-backed `getCurrentTenantId()`. Convenience and a
   guard rail (assertions, audit logging), not the enforcement mechanism —
   nothing stops a bug from calling the database without ever consulting
   it.
2. **Repository/service tenant-awareness** — every repository function in
   `packages/sites` and `packages/domains` filters explicitly by
   `tenant_id`, derived via `requireCurrentTenantId()`, and _never_ accepts
   a `tenantId` argument from its caller. A repository function cannot be
   tricked into using the wrong tenant by a caller passing the wrong value,
   because there is no such parameter to pass.
3. **PostgreSQL Row-Level Security** — the actual, unconditional backstop.
   Enforced by Postgres itself on every query issued through the app role,
   independent of whether layers 1–2 were even reached. See below.
4. **Explicit tests** — `packages/tenant`, `packages/domains`,
   `packages/sites`, and `packages/observability` each carry tests that
   create two real tenants in a real Postgres database and assert one
   cannot read, update, or delete the other's rows. See
   [Testing](#how-the-tests-actually-exercise-rls) below.

Layers 1 and 2 are conventions enforced by code review and TypeScript's
type system where possible (e.g. repository functions have no `tenantId`
parameter to misuse) — they are not hard technical barriers. Layer 3 is.
If layers 1–2 vanished entirely tomorrow, layer 3 alone would still hold
the boundary — the "RLS rejects an insert whose tenant_id doesn't match
the active context, even bypassing the repository helper" test in
`packages/sites/src/site-repository.test.ts` exists specifically to prove
that.

## The three roles

Three distinct Postgres roles, three distinct connection strings
(`DATABASE_URL`, `DATABASE_URL_APP`, `DATABASE_URL_RESOLVER` — see
`.env.example`). Collapsing them into one connection would silently
collapse the security model.

| Role                   | Used by                                                                                  | Privileges                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provence360` (admin)  | migrations, dev seed, `packages/testkit` fixtures, `apps/admin`'s cross-tenant dashboard | Table owner — Postgres never applies RLS to an owner. Full, unconditional access. **Never used to serve a tenant-facing request.**                                                                                                                                                                                                                |
| `provence360_app`      | every tenant-scoped repository, always via `withTenantContext()`                         | Full DML on all six tables, but every query is filtered by the RLS policies below. Cannot see or touch a row outside the active `app.tenant_id`.                                                                                                                                                                                                  |
| `provence360_resolver` | `packages/domains/src/resolver.ts` only                                                  | `SELECT`-only, and only on specific _columns_ of `sites` and `domains` (`id`, `tenant_id`, `status`, `hostname`, `site_id`, `is_primary` — never `name`, never anything content-shaped). Granted a permissive `USING (true)` RLS policy because its whole job is cross-tenant hostname lookup, which by definition runs before a tenant is known. |

`packages/database/src/scripts/setup-roles.ts` (via `pnpm db:setup-roles`)
creates/updates the app and resolver roles idempotently, deriving username
_and_ password from `DATABASE_URL_APP`/`DATABASE_URL_RESOLVER` so the role
Postgres actually has can never drift from the connection string the app
uses to reach it.

## How `withTenantContext` actually enforces the boundary

```ts
await withTenantContext(tenantId, async (tx) => {
  // every query on `tx` is now RLS-scoped to `tenantId`
});
```

Internally: one Postgres transaction, `select set_config('app.tenant_id', $1, true)`
run first (the parameterized equivalent of `SET LOCAL` — no string
interpolation of the tenant id into SQL), then the caller's callback runs
against that transaction. `set_config(..., true)` is scoped to the
transaction and is reset automatically on `COMMIT`/`ROLLBACK` — there is
nothing to leak onto the next request that happens to reuse the same
pooled connection, and nothing to remember to clean up.

A request that never calls `withTenantContext()` has no tenant-scoped
database access at all: `current_setting('app.tenant_id', true)` returns
`NULL` when unset, `tenant_id = NULL` is never true, and RLS denies every
row. This is exercised directly by the "fails closed" test in
`packages/tenant/src/with-tenant-context.test.ts`.

## RLS policies, table by table

Defined in `packages/database/src/schema.ts`, next to each table:

- **`tenants`** — `id = current_setting('app.tenant_id', true)::uuid`. A tenant can only ever see its own row.
- **`memberships`, `sites`, `domains`** — `tenant_id = current_setting('app.tenant_id', true)::uuid`, for all four commands (`SELECT`/`INSERT`/`UPDATE`/`DELETE`), as both the `USING` (which rows are visible) and `WITH CHECK` (which rows may be written) clause. A write that tries to set the wrong `tenant_id` is rejected by `WITH CHECK`, not just hidden from later reads.
- **`users`** — no `tenant_id` column (see [MULTI_TENANCY.md](MULTI_TENANCY.md) for why). Visibility is instead `EXISTS (SELECT 1 FROM memberships WHERE user_id = users.id AND tenant_id = current tenant)` — a user is visible only to a tenant it actually has a membership in.
- **`audit_logs`** — `SELECT` and `INSERT` policies exist for the app role; **no `UPDATE`/`DELETE` policy does**. With RLS enabled, an operation with no matching permissive policy is denied outright, regardless of `tenant_id`. The audit trail is append-only at the database level, not by application convention — see the immutability tests in `packages/observability/src/audit-log.test.ts`.
- **`sites`, `domains`** additionally carry a second, `SELECT`-only, `USING (true)` policy granted to `provence360_resolver` — see [the three roles](#the-three-roles).

## How the tests actually exercise RLS

`packages/testkit` points every test at a real Postgres database
(`DATABASE_URL*` with `NODE_ENV=test`, i.e. `provence360_test` locally, a
dedicated service container in CI — see `.github/workflows/ci.yml`). Test
fixtures are written through the _admin_ connection (deliberately
RLS-bypassing — arranging a cross-tenant scenario requires being able to
create both tenants' data), and every assertion about isolation reads or
writes through `withTenantContext()`, i.e. through `provence360_app`,
subject to the exact same RLS policies production code runs under. Nothing
here is mocked — a broken policy fails a real query against a real
database, not an assertion against an in-memory stand-in.

## Known gaps (tracked, not hidden)

- No authentication yet. `apps/admin` is an unauthenticated, cross-tenant, read-only dashboard — do not deploy it publicly reachable. See [ROADMAP.md](ROADMAP.md).
- `docker-compose.yml` uses a fixed dev password (`provence360`). Fine for local dev; a real deployment must use secrets management for `DATABASE_URL*`.
- No rate limiting, no WAF, no secrets scanning in CI beyond "don't commit `.env`" — out of scope for Foundation v0.1.
