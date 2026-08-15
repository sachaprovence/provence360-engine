# ADR 0008: Declarative role grants, and a fourth narrow role for identity

## Status

Accepted.

## Context

Two separate problems, addressed together because the second is a direct
extension of the first's reasoning.

**Problem 1 — hand-maintained grants.** Foundation v0.1 (see ADR 0005)
created `provence360_resolver` with its column-level `GRANT`s issued
imperatively, at runtime, from `packages/database/src/scripts/setup-roles.ts`.
That script was idempotent and worked, but the actual set of columns a
narrow role could read lived in application code, not in a versioned
migration — nothing enforced that a schema change and its corresponding
grant change shipped together, and nothing would catch a future column
silently becoming readable by a role that was supposed to be restricted.

**Problem 2 — a new narrow role.** Foundation v0.2 needs to check "does
this session belong to a real user, and does that user have a Membership in
this tenant?" _before_ any tenant context exists — the same chicken-and-egg
problem ADR 0005 solved for hostname resolution. Login, session validation,
and membership lookups all need to read `users`, `sessions`, `memberships`,
and `tenants` pre-tenant-context, but must never be able to read tenant
_content_ (sites, domains) — and `provence360_app` (tenant-scoped) must
never be able to read `password_hash` or `sessions` at all.

## Decision

- **Grants are now declarative and versioned.** `packages/database/migrations/0003_auth_role_grants.sql`, a hand-authored custom migration (`drizzle-kit generate --custom`), holds every column-level `GRANT`/`REVOKE` for `provence360_app`, `provence360_resolver`, and the new `provence360_auth` role. `setup-roles.ts` now only creates/syncs the roles themselves and grants `CONNECT`/`USAGE` (the two privileges that must stay imperative, since they reference the runtime database name) — every table- and column-level privilege lives in a migration, reviewed and applied the same way as any other schema change, upgraded the same way on `pnpm db:migrate`.
- `provence360_app`'s own grant on `users` was tightened in the same migration: `REVOKE ALL` followed by `GRANT SELECT (id, email, name, created_at, updated_at)` — explicitly excluding `password_hash`. Tenant-scoped application code was never able to read it before this migration either (the column didn't exist), but now that it does, the grant is the thing that keeps it that way, not convention. `packages/tenant/src/with-tenant-context.test.ts` has a standing regression test asserting exactly this: a blanket `select()` against `users` from the app role fails with `permission denied`, even inside a legitimate tenant context for a user the tenant can otherwise see.
- **A fourth role, `provence360_auth`**, mirrors `provence360_resolver`'s shape (narrow, column-restricted, usable with no tenant context) but for identity instead of routing:
  - `sessions`: full `SELECT`/`INSERT`/`UPDATE`/`DELETE` — it's the only role that ever touches this table.
  - `users`: `SELECT` on all columns (needed to look up a login attempt by email) plus `UPDATE (password_hash, updated_at)` — narrower than "own the table," wider than the resolver pattern, because identity lookups legitimately need more than routing metadata does.
  - `memberships`, `tenants`: `SELECT`-only, the read side of `getMembership()`/`listMembershipsForUser()` — this role never mutates a membership; that still goes through `packages/auth/src/membership-repository.ts`, tenant-scoped, permission-checked.
  - `audit_logs`: `SELECT`, `INSERT` only, and its own RLS policies (`auth_insert_audit_logs` `WITH CHECK tenant_id IS NULL`, `auth_read_audit_logs` `USING tenant_id IS NULL`) make it structurally impossible for this role to write or read a tenant-scoped audit row — see `packages/auth/src/audit.test.ts`'s regression tests for both directions.
  - No grant at all on `sites` or `domains` — verified by `packages/auth/src/role-boundaries.test.ts`.

## Consequences

- A future schema change that touches a sensitive column now has to touch a migration to grant access to it — the same review path as any other DDL, not a separate, easy-to-forget runtime script. This directly resolves the v0.1-documented "grants are hand-maintained" tech debt.
- Four roles, not three, each with a narrower job than the one before it: admin/owner (migrations, unrestricted), `provence360_app` (tenant-scoped, RLS-enforced), `provence360_resolver` (routing, pre-tenant, columns only), `provence360_auth` (identity/authorization, pre-tenant, columns only). The resolver and auth roles' grants are fully disjoint by design — the resolver can never see a password hash or a session, the auth role can never see a site's content — verified directly rather than assumed.
- One more role is one more thing `docker-compose.yml`, `.env.example`, and the CI setup step have to provision (`DATABASE_URL_AUTH` joins `DATABASE_URL_APP`/`DATABASE_URL_RESOLVER`) — accepted, because the alternative (reusing an existing role for a job it wasn't scoped for) is exactly the kind of grant creep this ADR exists to prevent.
