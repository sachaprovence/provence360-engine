# ADR 0012: Platform-level catalogs for Amenities and Media references

## Status

Accepted.

## Context

Two smaller, related decisions, bundled because they share one reasoning:

**Amenities.** A free-text `amenities: string[]` on `Unit` was the
tempting shortcut — but "wifi" vs "WiFi" vs "internet" vs "wi-fi" as four
different tenants' independent strings is exactly the kind of thing that
makes cross-site search, filtering, translation, and iconography
impossible to build later. The brief (section 8) asks for a _governed_,
structured catalog instead.

**Media.** The brief (section 9) is explicit that the full upload/CDN/
image-optimization pipeline is out of scope for v0.3 — but also that
"content must never depend on URLs arbitrary dispersed everywhere." A
domain model needs a stable, typed thing to _reference_ today, even before
the thing it references has a real upload flow behind it.

## Decision

- **`amenities` is a platform-level catalog**, the same shape as `themes` (`docs/adr/0011-theme-token-model.md`): a small, curated, non-tenant-scoped table (`key`, `category`, `label`, `description`, `iconKey`, `status`), readable by every tenant via a permissive RLS `SELECT` policy, writable only by the admin/owner role. `unit_amenities` is the tenant-scoped join row asserting "this Unit (mine) has this Amenity (the shared catalog's)" — it carries `tenant_id` and the composite-FK-to-`units` pattern from `docs/adr/0010-property-unit-ownership.md`, but `amenity_id` is an ordinary (non-composite) foreign key straight to the catalog, since the catalog itself isn't tenant data to protect.
  - Per-amenity metadata (`unit_amenities.metadata`, e.g. `{ heated: true }` for a pool) is supported from day one as a small, optional JSONB column — but nothing in v0.3 defines or validates a schema _per amenity key_ for it. That's deliberately deferred: building a metadata schema per catalog entry today, before there's a second real consumer of it, is exactly the over-engineering section 8 of the brief warns against.
- **`media_assets` is a tenant-scoped reference table**, not an upload pipeline. `storageKey` is an opaque pointer (whatever a deployment's object storage calls it) — this table records "there is a file, here's its identity, its declared MIME type, its dimensions if known, its alt text" — it does not move bytes, transform images, or talk to a CDN. Content (a Gallery block's `props`, a Property's photo) references `MediaAsset.id`, never a bare URL string.
  - This reference is **not** a database foreign key from inside JSONB — a block instance's `props.mediaAssetIds` is validated by the Block Registry's Zod schema (see `docs/adr/0014-block-registry-versioning.md`) to be well-formed UUIDs, and the renderer looks them up at render time, scoped to the current tenant (so a stale or cross-tenant id simply resolves to nothing, fails closed, never leaks another tenant's asset — see the adversarial test suite). This is a real, documented compromise: Postgres cannot enforce "every UUID inside this JSONB array points at a real, same-tenant `media_assets` row" the way the composite-FK trick enforces `properties.site_id`. Accepted because the alternative (a fully relational block-to-media join table per block type) is disproportionate for v0.3's scope, and the render-time, tenant-scoped lookup already fails safe rather than exposing anything.

## Consequences

- Amenity iconography, translation, and filtering all become tractable later without a data migration — the catalog already has the shape (`key`, `category`, `iconKey`) those features need.
- A tenant cannot invent a new amenity through the application in v0.3 — a real, current limitation (not silently hidden — see `docs/ROADMAP.md`), acceptable because the catalog needing platform curation is the entire point.
- `media_assets` gives the domain model a stable identity for images/video/documents today; the actual upload UX, storage backend, and CDN integration remain a clearly-scoped future phase (`docs/ROADMAP.md`), not something this ADR pretends to have solved.
- The one place this schema trusts JSONB content rather than a DB constraint (media references inside block props) is called out explicitly here and in `docs/RENDERING.md`, rather than left as an implicit, undiscovered gap.
