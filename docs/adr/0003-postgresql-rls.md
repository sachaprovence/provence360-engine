# ADR 0003: PostgreSQL Row-Level Security as the enforcement layer

## Status

Accepted.

## Context

Given a shared database ([ADR 0002](0002-shared-database-multi-tenancy.md)),
something has to guarantee Tenant A can never read, write, or delete
Tenant B's rows. The candidates: trust every repository function to
remember a `WHERE tenant_id = ...` clause (application-level only), or push
the guarantee down into the database engine itself.

## Decision

Postgres Row-Level Security, with policies defined alongside each table in
`packages/database/src/schema.ts` (Drizzle's `pgPolicy`/`.enableRLS()`).
Three distinct, non-owner Postgres roles connect with different privileges
(`provence360_app`, RLS-scoped; `provence360_resolver`, read-only and
column-restricted; the admin/owner role, unrestricted, used only for
migrations/seed/fixtures) — see `docs/SECURITY.md#the-three-roles`. Every
tenant-scoped table's policy keys off a transaction-local session variable
(`app.tenant_id`), set exactly once per request by `withTenantContext()`
(`packages/tenant`) via `set_config(..., true)` — the parameterized
equivalent of `SET LOCAL`, scoped to one transaction and reset
automatically, so it can never leak onto a pooled connection reused by a
different tenant's request.

Repository code (layer 2 of the defense-in-depth in `docs/SECURITY.md`)
still filters by `tenant_id` explicitly — RLS is the backstop for when that
discipline lapses, not a reason to skip it.

## Consequences

- Isolation holds even if a repository function has a bug, forgets a `WHERE` clause, or a future contributor doesn't know the convention exists. This is proven directly by `packages/sites/src/site-repository.test.ts`'s "RLS rejects an insert whose tenant_id doesn't match the active context, even bypassing the repository helper" test.
- A query issued with no tenant context at all (`app.tenant_id` never set) sees zero rows rather than every row — fail-closed by construction, not by an explicit check someone has to remember to write. Proven by `packages/tenant/src/with-tenant-context.test.ts`.
- The cost: RLS policies are one more thing to review carefully (a wrong `USING` clause is a real vulnerability, not a typo caught by the type checker), and they add a small, constant per-query overhead. Accepted, because the alternative is trusting every future line of repository code to get a `WHERE` clause right, forever.
- Migrations that touch RLS policies need the same scrutiny as anything touching authentication — this is documented explicitly in `docs/SECURITY.md` rather than left implicit.
