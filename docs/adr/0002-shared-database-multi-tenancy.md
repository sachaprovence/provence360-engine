# ADR 0002: Shared database, not database-per-tenant

## Status

Accepted.

## Context

Two well-known ways to isolate tenant data: a separate database (or
schema) per tenant, or one shared database with every tenant's rows
interleaved and isolation enforced by policy. The target scale is "several
hundred sites."

## Decision

One shared PostgreSQL database, one `public` schema, tenant-scoped tables
carry a `NOT NULL tenant_id`. Isolation is enforced by Postgres Row-Level
Security (see [ADR 0003](0003-postgresql-rls.md)), not by connecting to a
different database per tenant.

## Consequences

- A schema migration is one `ALTER TABLE`, run once — not hundreds of migrations, one per tenant database, that can drift out of sync.
- Connection pooling stays sane: one pool per role (`provence360_app`, `provence360_resolver`), not one pool per tenant. At hundreds of tenants, a pool-per-tenant model would exhaust connections long before it exhausted tenants.
- "Provision a new site" is an `INSERT`, not a database-creation operation with its own failure modes, backup schedule, and access-control setup.
- The cost: a bug in a shared-database system can, in principle, leak data across tenants in a way a database-per-tenant system structurally cannot. This is exactly why RLS (enforced by Postgres itself, independent of application code) is the actual boundary — see `docs/SECURITY.md`. Database-per-tenant was rejected specifically because it doesn't scale to "hundreds," not because isolation doesn't matter — it matters enough that this repo enforces it at the database engine level instead of trusting connection topology alone.
