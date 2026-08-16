# Site Domain

Foundation v0.3 introduces the engine's first real business domain — the
seasonal-rental data every site actually exists to present — and
extends `Site` itself into a genuine presentation/configuration root. This
document covers the data model; see [docs/CONTENT_MODEL.md](CONTENT_MODEL.md)
for how that data gets rendered, and [docs/THEMES.md](THEMES.md) for how a
Site is styled.

## The three data planes

Every new table in v0.3 falls into exactly one of three categories — the
brief calls this out explicitly, and it stays true throughout the model:

| Plane                         | Examples                                                     | Owner concept                                              |
| ----------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| **Business/domain data**      | `properties`, `units`, `amenities`, `media_assets`           | The Rental domain — what's actually for rent, structurally |
| **Presentation/content data** | `pages`, block instances inside `pages.content`              | The Content Graph — how it's marketed and arranged         |
| **Runtime/platform data**     | `sites.theme_id`, `sites.feature flags`, tenant, RLS context | How the site is configured to run                          |

A Property's `maxGuests` is domain data — true regardless of which site
markets it, or how. A Hero block's headline is presentation data — a
copywriting choice, not a fact about the villa. `sites.theme_id` is
platform data — which design system this deployment uses. Mixing these
(e.g. hard-coding a guest count into marketing copy, or storing a theme
choice as a "feature") is exactly what future edits, translations, and
multi-site reuse would make expensive; keeping them separate is what makes
"apply this fix to all 200 sites" or "change this villa's capacity" each a
one-row edit in the right table.

## Site (extended)

`sites` (already the tenant's site row since v0.1) gained, in v0.3:
`publicName`, `timezone` (default `Europe/Paris`), `defaultLocale`
(default `fr`), `enabledLocales` (JSONB array of locale tags, default
`["fr"]`), `contactEmail`, `contactPhone`, `themeId` (FK to the platform
`themes` catalog, nullable), `themeOverrides` (JSONB, closed token schema
— see [docs/THEMES.md](THEMES.md)), `navigation` (JSONB), `features`
(JSONB).

The JSONB columns here (`themeOverrides`, `navigation`, `features`) are
all genuinely polymorphic _configuration_, each independently
Zod-validated on write — never one giant unvalidated blob holding
everything about the site. `navigation`/`features` are intentionally loose
in v0.3 (no closed schema yet, matching how little uses them today); the
one that actually gates behavior today (`themeOverrides`) is validated
against a closed catalog, per [ADR 0011](adr/0011-theme-token-model.md).

## Property and Unit

See [ADR 0010](adr/0010-property-unit-ownership.md) for the full ownership
reasoning. The shape:

- **`Property`** — a physical place: internal/public name, slug (unique
  per site), structured description, `propertyType` (villa/house/gite/
  domaine/guest_house/apartment/other), a structured address (line 1/2,
  city, postal code, region, country), `latitude`/`longitude`
  (`numeric(9,6)`, nullable), timezone, status (draft/active/archived).
  Belongs to exactly one `Site` in v0.3 (`properties.site_id`, `NOT NULL`)
  — see the ADR for the future many-Sites-per-Property extension path.
- **`Unit`** — a separately describable, potentially separately bookable
  part of a Property: internal/public name, slug (unique per property),
  status (draft/active/archived/**not_bookable_separately**), `maxGuests`,
  `bedrooms`, `beds`, `bathrooms` (`numeric(3,1)` — half-bathrooms are a
  real value, e.g. `2.5`), `size` + `sizeUnit` (`sqm`/`sqft`), a basic
  description, `ordering` (int, default 0, drives display order in
  `UnitGrid` — see [docs/CONTENT_MODEL.md](CONTENT_MODEL.md)).

  Explicit decisions on the "must decide" fields the brief calls out:
  - **Unknown capacity/room counts** (`maxGuests`, `bedrooms`, `beds`) are
    nullable, never defaulted to `0` — "unknown" and "zero" are different
    facts (a studio genuinely has 0 separate bedrooms; a not-yet-measured
    villa has an _unknown_ bedroom count) and must stay distinguishable.
  - **Unknown size** is simply both `size` and `sizeUnit` left `NULL`.
    Whenever `size` is present, `sizeUnit` must be too, and vice versa —
    enforced by a real Postgres `CHECK` constraint
    (`units_size_requires_unit_ck`), not only application-layer Zod, so a
    unit can never end up with "220" and no unit, or a unit with no
    number.
  - **A Unit that isn't separately bookable** (e.g. a single room
    described for informational purposes inside a villa that's always
    booked as a whole) is `status = 'not_bookable_separately'` — a real,
    named status rather than an ad hoc flag on top of `active`. The
    renderer's `UnitGrid` still displays it; a future booking engine
    would treat it as informational-only.
  - Never assume 1 Property = 1 Unit, and never assume 1 Tenant = 1 Site —
    a Property may hold several Units ("Domaine des Oliviers" → villa +
    studio + room), and a Tenant may run several Sites. The seed data
    (`packages/database/src/scripts/seed.ts`) deliberately exercises both
    the multi-Unit case (Villa des Oliviers: 2 Units) and the
    single-Unit case (Mas du Luberon: 1 Unit) — modeled identically, not
    as two different shapes.

## Amenities

A governed, platform-level catalog (`amenities`: `key`, `category`
[connectivity/wellness/outdoor/comfort/safety/accessibility/other],
`label`, `description`, `iconKey`, `status`) — never free-text strings on
a Unit. `unit_amenities` is the tenant-scoped join asserting "this Unit
has this catalog Amenity," with an optional per-attachment `metadata`
JSONB column (e.g. `{ heated: true }` for a pool) left deliberately
unschema'd in v0.3 — see [ADR 0012](adr/0012-media-asset-and-amenity-catalog.md)
for why a per-amenity metadata schema is explicitly not built yet.

## MediaAsset

A tenant-scoped reference table, not an upload/CDN pipeline (see
[ADR 0012](adr/0012-media-asset-and-amenity-catalog.md)):
`kind` (image/video/document), `storageKey` (an opaque pointer — this
schema doesn't move bytes), `mimeType`, `width`/`height` (nullable),
`altText`, `metadata` (JSONB), `createdAt` (deliberately no `updatedAt` —
a new version of a file is a new row, never an edit, the same
immutability reasoning as an audit log entry). Content references
`MediaAsset.id`, never a bare URL.

## Ownership consistency: DB constraints, not only RLS

Every new tenant-scoped table carries both `tenant_id` (for RLS) **and** a
composite foreign key tying `(tenant_id, parent_id)` to the parent's own
`(tenant_id, id)` — `properties → sites`, `units → properties`,
`unit_amenities → units`, `pages → sites`. A row that tried to claim
`tenant_id = A` while pointing at a parent owned by tenant `B` is rejected
by Postgres at `INSERT`/`UPDATE` time (`23503 foreign_key_violation`),
_before_ RLS's `WITH CHECK` clause is ever reached — a second, independent
layer behind RLS, not a replacement for it. See
[ADR 0010](adr/0010-property-unit-ownership.md) and
[docs/SECURITY.md](SECURITY.md).

The one deliberate compromise: a JSONB array (a Gallery block's
`mediaAssetIds`, a UnitGrid block's `propertyId`) cannot be a real foreign
key from inside JSONB. That gap is closed at read time instead — every
lookup is scoped to the current tenant, so a stale or cross-tenant
reference resolves to nothing rather than leaking — see
[docs/RENDERING.md](RENDERING.md#error-handling) and
[ADR 0012](adr/0012-media-asset-and-amenity-catalog.md).

## Future Release compatibility

For every table above, ask: if a future immutable `Release` snapshot must
still reproduce this page in six months, is this row **referenced** (must
still exist, unchanged in meaning) or must it be **snapshotted** (copied
into the Release at publish time)?

- **Referenced, safely:** `Property`/`Unit`/`Amenity` rows are business
  facts that are expected to stay current — a `PropertySummary` block
  intentionally shows _today's_ Property data even for an old Release, the
  same way a printed brochure with a phone number on it doesn't freeze the
  phone number's meaning. If this is ever wrong for a specific field (a
  historical "as advertised" guarantee), that's a future, explicit
  snapshot field on the Release, not a retroactive change to how Property
  data works today.
- **Snapshotted, once Release exists:** a Page's `content` (the block
  array) is exactly the shape [ADR 0013](adr/0013-page-content-storage.md)
  chose specifically because it's trivial to copy whole into a future
  Release row — no join to reconstruct.
- **Already immutable by convention:** `MediaAsset` rows (no `updatedAt` —
  a new version is a new row), `AuditLog` entries.

**v0.4 update:** the Draft → Release → Publish pipeline this section
anticipated now exists — see [docs/PUBLISHING.md](PUBLISHING.md) and
[ADR 0016](adr/0016-publishing-pointer-and-snapshot-model.md). The
distinction drawn above (Property/Unit/Amenity referenced live vs. a
Page's `content` snapshotted) is exactly what `packages/publishing`'s
Revision snapshot implements, unchanged from this section's original
design.

## Twelve invariants

The full set of architectural invariants this Foundation depends on,
carried through the code and the documents above:

1. Tenant ≠ Site ([ADR 0004](adr/0004-tenant-not-equal-site.md)).
2. Site ≠ Property — a Site is presentation/config; a Property is a
   physical place; a Site can (eventually) surface more than one.
3. Property ≠ Unit — a Property may hold several Units.
4. Domain data ≠ presentation data (see above).
5. Theme ≠ Site — a Theme is shared; a Site narrowly overrides it
   ([docs/THEMES.md](THEMES.md)).
6. Block type ≠ block instance — a type is a schema+renderer pair
   registered once; an instance is one validated, id-stable occurrence of
   it in a Page ([docs/BLOCK_SYSTEM.md](BLOCK_SYSTEM.md)).
7. The public Site resolved for a request comes from the hostname, never
   from anything the browser sends that it could forge
   ([ADR 0005](adr/0005-hostname-site-resolution.md)).
8. No client's content ever creates a new source component — content is
   always data flowing through the shared renderer.
9. No tenant can reference another tenant's resource — enforced by RLS
   _and_ composite foreign keys (see above).
10. All polymorphic (JSONB) data is runtime-validated, always, never
    trusted as pre-clean.
11. An old block version must remain understandable — [ADR 0014](adr/0014-block-registry-versioning.md).
12. A future Release must be able to snapshot a Page into something
    immutable, without a schema change today (see above).
