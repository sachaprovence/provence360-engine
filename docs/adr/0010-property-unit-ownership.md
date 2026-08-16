# ADR 0010: Property/Unit ownership — one Site, composite-FK enforced

## Status

Accepted.

## Context

Foundation v0.3 introduces the first real business domain: seasonal-rental
properties. The brief is explicit that neither of two tempting
simplifications may be assumed:

- **1 Tenant = 1 Site** — already false since v0.1 (`docs/MULTI_TENANCY.md`); a tenant may run several branded sites.
- **1 Site = 1 logement (one rentable unit)** — a `Property` may itself hold several separately describable `Unit`s ("Domaine des Oliviers" → main villa, studio, independent room), and a single-unit case ("Villa du Ventoux") is just a Property with one Unit, not a different shape.

The open question this ADR resolves: does a `Property` belong to a
`Tenant` only, or does it also carry a direct `Site` ownership, and if the
latter, how is that cross-table relationship kept honest under multi-tenant
RLS — where "the row disappeared" (RLS) and "the row was never allowed to
exist" (a constraint) are different guarantees?

## Decision

- **A `Property` belongs to exactly one `Site` in v0.3** (`properties.site_id`, `NOT NULL`), which itself belongs to exactly one `Tenant`. This is the simplest model that is still _correct_ for the stated goal (representing Villa A/Maison B/Gîte C/Domaine D on their own sites) — not a claim that a Property could never reasonably appear on more than one Site. If that need arises later, it's a new join table (`property_site_placements` or similar) added _alongside_ `properties.site_id`, not a breaking change to Property's own columns — the current column simply becomes "the primary/default placement."
- **`Unit` belongs to exactly one `Property`** (`units.property_id`, `NOT NULL`) — the Domaine-des-Oliviers/Villa-du-Ventoux distinction lives entirely in how many Unit rows a Property has, never in a schema branch.
- **Ownership consistency is a database constraint, not only an RLS side-effect.** Every child table carries its own `tenant_id` _and_ a composite foreign key tying `(tenant_id, parent_id)` to the parent's `(tenant_id, id)`:
  - `properties (tenant_id, site_id)` → `sites (tenant_id, id)`
  - `units (tenant_id, property_id)` → `properties (tenant_id, id)`
  - `unit_amenities (tenant_id, unit_id)` → `units (tenant_id, id)`
  - `pages (tenant_id, site_id)` → `sites (tenant_id, id)`

  Each parent table therefore also carries a `UNIQUE (tenant_id, id)` index (redundant with the plain primary key, but required for Postgres to accept it as a composite FK target). A row that tried to claim `tenant_id = A` while pointing `site_id` at a Site owned by tenant `B` is rejected by Postgres itself at `INSERT`/`UPDATE` time — `23503 foreign_key_violation` — before RLS's `WITH CHECK` clause is ever reached. Two independent layers, either one alone would stop it; see `docs/SECURITY.md`'s existing defense-in-depth framing, now extended one layer further than RLS+repository-convention alone.

- Repository code additionally verifies the parent is visible under the _current tenant context_ before referencing it (the same pattern `packages/domains/src/domain-repository.ts` already established for `Site`) — belt and braces: the composite FK stops a forged cross-tenant row from being written at all; the repository check turns that into a clean, typed `NotFoundError` instead of a raw Postgres constraint-violation exception leaking into a Server Action.

## Consequences

- Every "does X actually belong to the tenant that's trying to touch it" question about Property/Unit/Page ownership is answered the same way sessions/RLS already answer "is this user actually who they claim" — by a constraint that cannot be forgotten in a future repository function, not only by application discipline.
- The schema is slightly more verbose (an extra unique index per referenced parent, an extra `foreignKey()` block per child) — accepted, because the alternative (trusting every future INSERT to get `tenant_id` right by convention) is exactly the class of bug `docs/SECURITY.md` exists to rule out structurally.
- A future many-Sites-per-Property feature has a clear extension point (an additional join table) rather than requiring `properties.site_id` to become nullable and every existing query to grow a null-check.
