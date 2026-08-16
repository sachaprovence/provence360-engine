# ADR 0004: Tenant ≠ Site

## Status

Accepted.

## Context

The obvious simplification is one tenant == one site: a customer signs up,
gets a site, done. But the brief is explicit that "a tenant can own several
sites" — a property manager running multiple separately-branded rental
portfolios under one account is a real, expected shape, not a hypothetical.

## Decision

`tenants` and `sites` are separate tables with a one-to-many relationship
(`sites.tenant_id`). `Tenant` is the security/billing boundary; `Site` is a
public website. `Domain` binds a hostname to a `Site`, not to a `Tenant`
directly.

## Consequences

- "This account runs three branded sites" is `INSERT INTO sites` three times, not a data-model change.
- Every permission/billing/quota decision is made at the tenant level; every rendering/SEO/domain decision is made at the site level. These stay independent variables instead of being forced to move together.
- RLS policies still key off `tenant_id` (denormalized onto `sites` and `domains` — see [ADR 0005](0005-hostname-site-resolution.md)) rather than `site_id`, because the security boundary is the tenant, not the site — two sites under the same tenant are allowed to see each other exists (they're the same customer), but never another tenant's sites.
- The cost: one more join/lookup than the collapsed model in places like domain creation (`packages/domains/src/domain-repository.ts` has to verify the target site belongs to the current tenant before attaching a domain to it). Accepted, because the alternative — collapsing them — would make the multi-site case a breaking schema migration instead of a row insert.
