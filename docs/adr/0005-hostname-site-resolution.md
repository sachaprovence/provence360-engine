# ADR 0005: Resolving sites by hostname, via a dedicated read-only role

## Status

Accepted.

## Context

The public entry point to this whole system is an incoming HTTP request's
`Host` header. Resolving it to a `Site` (and from there a `Tenant`) has to
happen _before_ any tenant is known — which means it structurally cannot go
through `withTenantContext()` ([ADR 0003](0003-postgresql-rls.md)), the
mechanism everything else in this codebase uses to touch the database. That
function requires a `tenantId` as its first argument; hostname resolution
is precisely the step that doesn't have one yet.

The browser cannot be trusted to say which tenant it wants (see
`docs/SECURITY.md` — "no `tenant_id` from a query parameter, body, or
header decides the security boundary"), so this lookup has to be driven
entirely by server-side state: the `domains` table.

## Decision

- `domains.hostname` is normalized (lowercased, port stripped, `www.` treated as equivalent to bare — `packages/validation/src/hostname.ts`) both on write and on lookup, so `Villa-Cassis.COM`, `www.villa-cassis.com`, and `villa-cassis.com:8443` all resolve to the same row.
- A dedicated, non-owner Postgres role (`provence360_resolver`) exists solely for this lookup: `SELECT`-only, column-restricted (via `GRANT SELECT (...)`) to routing metadata only — `id`, `tenant_id`, `status` on `sites`; `id`, `site_id`, `tenant_id`, `hostname`, `is_primary`, `status` on `domains`. It can never see a site's name, content, or anything belonging to any other table. This is the one deliberate, reviewed exception to "no read without tenant context," kept as narrow as Postgres grants allow.
- `domains.tenant_id` is denormalized from the owning site (rather than requiring a join through `sites` inside the RLS policy) purely so both the resolver's query and the `tenant_isolation_domains` RLS policy stay flat, indexable equality checks.
- An active hostname is unique globally (`domains_hostname_active_uidx`, a partial unique index on `status = 'active'`), so two tenants can never simultaneously claim the same live domain — enforced by Postgres, not by an application-level uniqueness check that could race.
- Resolution failure is silent and clean: malformed or unknown hostnames return `null` from `resolveSiteByHostname()`, never a thrown error into the request path. `apps/web` turns that into a proper `404` via `notFound()`.

## Consequences

- The resolver role is a real, if narrow, exception to the "always go through withTenantContext" rule — documented explicitly rather than smuggled in as an unexplained special case. Column-level grants mean even a compromised or buggy resolver query can't exfiltrate site content, only routing metadata that's arguably public anyway (a hostname resolving to _some_ site is not a secret — what's on that site is).
- Every other tenant-scoped read in this codebase can hold the invariant "if it queried the database, a tenant context was active" — the resolver is the one named exception, not a precedent to extend casually.
