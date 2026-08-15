# Multi-tenancy

## Strategy: shared database, RLS-enforced isolation

One Postgres database, one schema, every tenant's rows interleaved in the
same tables. The alternative (a database — or schema — per tenant) doesn't
scale operationally to "several hundred sites": every migration, every
backup, every connection pool multiplies by tenant count. Shared-database
is what makes "a new client is a database row" actually true; see
[ADR 0002](adr/0002-shared-database-multi-tenancy.md).

The cost of sharing a database is that a bug can leak data across tenants
unless something _other than application code_ enforces the boundary. That
something is Postgres Row-Level Security — see
[ADR 0003](adr/0003-postgresql-rls.md) and
[docs/SECURITY.md](SECURITY.md) for the mechanics.

## Tenant ≠ Site

These are deliberately two different things (see
[ADR 0004](adr/0004-tenant-not-equal-site.md)):

- **Tenant** — who owns and pays for this. The security/billing boundary.
- **Site** — a public website. A tenant can run several (e.g. a property
  management company operating "Villas Cassis" and "Mas du Luberon" as two
  separately-branded sites under one account).

Collapsing them (one site == one tenant) would make "a tenant runs multiple
brands" a schema migration instead of an `INSERT`.

## Domain resolution

**Domain** — a hostname bound to a site. See
[ADR 0005](adr/0005-hostname-site-resolution.md) for the resolver design.
Key invariants, enforced in `packages/database/src/schema.ts`:

- `domains.tenant_id` is denormalized from the owning `site.tenant_id`, purely so the RLS policy on `domains` stays a flat, indexable equality instead of a cross-table join. `packages/domains/src/domain-repository.ts` is what keeps the two in sync — it looks the target site up through the _current tenant's own RLS-scoped view_ before attaching a domain to it, so a domain can never end up pointing at a site it doesn't actually belong to.
- A hostname is unique **globally** while `status = 'active'` (partial unique index `domains_hostname_active_uidx`) — two tenants can never simultaneously serve the same live domain. Non-active rows (`pending`, `disabled`) don't collide, so a released domain can be re-claimed.
- Hostnames are normalized before storage and before lookup (`packages/validation/src/hostname.ts`): lowercased, port stripped, leading `www.` treated as equivalent to the bare domain, trailing dot stripped. `villas-cassis.com`, `WWW.Villas-Cassis.COM`, and `villas-cassis.com:8443` all resolve identically.

## Users are global, Memberships are the tenant boundary

`users` deliberately has **no `tenant_id` column**. A person authenticates
once; `memberships` (user × tenant × role) is what determines which
tenants they can act as and with what role — the same shape as a GitHub
account existing independently of the organizations it belongs to.

This is why the dev seed (`packages/database/src/scripts/seed.ts`) includes
a contractor (`eve@contractor.test`) with a membership in _both_ seeded
tenants: that's the scenario this design exists for. A `tenant_id` column
on `users` would make it structurally impossible.

RLS on `users` follows from this: there's no `tenant_id` to compare, so
visibility is instead `EXISTS (... memberships WHERE user_id = users.id AND
tenant_id = current tenant)` — see [SECURITY.md](SECURITY.md#rls-policies-table-by-table).

## `withTenantContext` — the only door in

```ts
import { withTenantContext } from "@provence360/tenant";

const site = await withTenantContext(tenantId, async (tx) => {
  return getSiteBySlug(tx, "villas-cassis");
});
```

Every tenant-scoped read or write in this codebase goes through this
function. It is the single place that: validates `tenantId` is a real UUID
before touching the database, sets the transaction-scoped Postgres session
variable RLS policies key off of, and gives repository code a `tx` handle
that is only ever obtainable this way. See
[SECURITY.md](SECURITY.md#how-withtenantcontext-actually-enforces-the-boundary)
for the implementation, and `packages/tenant/src/with-tenant-context.test.ts`
for the isolation tests it's held to.

## What's NOT modeled yet

`Draft`, `Releases`, `Theme`, `Settings`, `Assets`, `Pages`, per-site
languages/features/SEO/integrations — all deferred, see
[ROADMAP.md](ROADMAP.md). The `sites` table today has just enough
(`slug`, `name`, `status`) to prove the resolution pipeline; it is not the
final shape of a site.
