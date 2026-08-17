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
everything about the site. `themeOverrides` is validated against a closed
token catalog (per [ADR 0011](adr/0011-theme-token-model.md));
`navigation` gained its own closed, typed contract in v0.5 —
`packages/content/src/navigation.ts`'s `navigationSchema` — see
[ADR 0017](adr/0017-site-composition-kernel.md) and
[docs/PUBLISHING.md#navigation-v05](PUBLISHING.md#navigation-v05).
`features` remains intentionally loose (no closed schema yet, matching
how little uses it today).

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

**v0.6 update — Guest Experience fields:** `Property` gained
`checkInTime`/`checkOutTime`/`quietHoursStart`/`quietHoursEnd` (native
Postgres `time`, locale-independent), `smokingPolicy`/`petsPolicy`/
`eventsPolicy` (a tri-state `allowed | not_allowed | on_request`, nullable
— "not specified" stays distinguishable from "not allowed," the same
unknown-≠-zero philosophy as `maxGuests`/`bedrooms`), and
`locationDisclosure` (`exact | approximate | hidden`, `NOT NULL DEFAULT
'exact'` — never breaks an already-seeded Property's rendered address).
`Unit` gained a structured detail table, `unit_sleeping_arrangements`
(room label, bed type, quantity, ordering) — the raw `beds` column stays
as the fallback aggregate when no detail rows exist. See
[ADR 0018](adr/0018-rental-domain-guest-experience.md) for the full
reasoning, including the hybrid aggregates-vs-detail strategy and why
`quietHoursStart`/`quietHoursEnd` have no ordering CHECK (a window
legitimately wraps midnight).

## Amenities

A governed, platform-level catalog (`amenities`: `key`, `category`
[connectivity/wellness/outdoor/comfort/safety/accessibility/other],
`label`, `description`, `iconKey`, `status`) — never free-text strings on
a Unit. `unit_amenities` is the tenant-scoped join asserting "this Unit
has this catalog Amenity," with an optional per-attachment `metadata`
JSONB column (e.g. `{ heated: true }` for a pool) left deliberately
unschema'd in v0.3 — see [ADR 0012](adr/0012-media-asset-and-amenity-catalog.md)
for why a per-amenity metadata schema is explicitly not built yet.

**v0.6 update:** `metadata` now has a real (small, `.strict()`) Zod schema
— `packages/rentals/src/validation.ts`'s `amenityMetadataSchema`, `{
featured?: boolean, note?: string }` — applied uniformly on write, closing
the gap noted above. Amenities are no longer Unit-only: `property_amenities`
is a second, identically-shaped join table (`this Property has this
catalog Amenity`) for facts that belong to the whole Property rather than
one Unit (a shared pool, on-site parking). See
[ADR 0018](adr/0018-rental-domain-guest-experience.md).

## MediaAsset

A tenant-scoped reference row (see
[ADR 0012](adr/0012-media-asset-and-amenity-catalog.md)):
`kind` (image/video/document), `storageKey` (an opaque pointer), `mimeType`,
`width`/`height` (nullable), `altText`, `metadata` (JSONB), `createdAt`
(deliberately no `updatedAt` — a new version of a file is a new row, never
an edit, the same immutability reasoning as an audit log entry). Content
references `MediaAsset.id`, never a bare URL. `packages/content` still owns
this entity exactly as ADR 0012 designed it — v0.9 does not change its
shape's _meaning_, only extends it.

**v0.9** turns the surrounding pipeline from "reference only, no real
upload path" into a real one (see
[ADR 0022](adr/0022-media-ingestion-asset-delivery.md) and
[docs/MEDIA.md](MEDIA.md)) — `packages/media`, a new package, owns upload
intents, real file validation, object storage, variant generation, and
delivery, and calls `createMediaAsset` only once real, validated bytes
exist. Four new, nullable/defaulted columns land on `media_assets`:
`checksumSha256` (also the delivery URL's fingerprint), `byteSize`,
`variants` (a closed, versioned JSONB registry of generated derivatives),
`originalFilename` (display-only, never authority-bearing). The
"new file = new row, never an edit" invariant above is exactly what v0.9's
delivery route relies on to make an immutable cache header honest.

## VirtualTour (v0.7)

A reference to an externally-hosted immersive tour (Matterport Showcase,
and — closed-registry — future providers), never the embed itself: see
[ADR 0019](adr/0019-virtual-tour-immersive-kernel.md). Deliberately not a
`MediaAsset` variant — a VirtualTour has an external provider, a business
lifecycle (`draft`/`active`/`archived`, same shape as `Property`/`Unit`),
and an embed policy, none of which fit MediaAsset's "reference to a stored
file" shape.

Always belongs to a `Property`; a `Unit` is optional — the same
"a Property may, but needn't, decompose into Units" shape
`unit_sleeping_arrangements` already establishes. When `unitId` is set,
the composite FK forces it to be a Unit of _this same_ Property and
tenant — Postgres-enforced, not merely a TypeScript-level check (see
"Ownership consistency" below).

Embedded on a Page via `virtual-tour@1`, the exact same generic
`BlockDefinition.references` mechanism every other domain block already
uses — no parallel reference system. The referenced row stays entirely
live at render time (Presentation-Frozen/Business-Live, unchanged from
Property/Unit): an admin repointing the tour's target asset, or archiving
it, takes effect on the public site immediately, without a republish. See
[docs/RENDERING.md](RENDERING.md) and
[docs/PUBLISHING.md](PUBLISHING.md).

## Ownership consistency: DB constraints, not only RLS

Every new tenant-scoped table carries both `tenant_id` (for RLS) **and** a
composite foreign key tying `(tenant_id, parent_id)` to the parent's own
`(tenant_id, id)` — `properties → sites`, `units → properties`,
`unit_amenities → units`, `pages → sites`, `virtual_tours → properties`
(and, conditionally, `virtual_tours → units` — see "VirtualTour" above).
A row that tried to claim
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

## Public vs. admin visibility (v0.6)

A Property/Unit's `status` governs two independent audiences differently:
the admin UI always shows every row a tenant owns, regardless of status —
an owner must be able to see and edit a `draft` Property they're still
setting up, or an `archived` one they've retired. The **public** runtime
must never show either. Before v0.6 this filtering was inconsistent:
`unit-grid.tsx` applied it inline; `property-summary.tsx`/`amenities.tsx`
applied none at all — an archived Property still rendered its full public
name and address.

v0.6 makes this one explicit, named boundary: `isPublicPropertyStatus`
(`status === "active"`) and `isPublicUnitStatus` (`active` or
`not_bookable_separately`), exported from `packages/rentals`, with public-
scoped read functions (`getPublicProperty`, `getPublicUnit`,
`listPublicUnitsForProperty`) layered on top of the unrestricted ones —
never a duplicated query. The renderer selects between them via
`RenderContext.publicOnly` (the direct sibling of v0.5's
`RenderContext.media` — see [ADR 0017](adr/0017-site-composition-kernel.md)),
set `true` only by `apps/web`'s public request pipeline. See
[ADR 0018](adr/0018-rental-domain-guest-experience.md) for the full
reasoning and its interaction with publish-time validation.

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

**v0.5 update:** `MediaAsset` moves from "referenced live" to
**snapshotted** — a Revision now freezes a `MediaDescriptor` copy (id,
kind, storageKey, mimeType, width, height, altText — never the binary
itself) of every MediaAsset any block/SEO field on its published Pages
references, precisely because a printed brochure's _photo_ (unlike its
phone number) is expected to stay exactly what was printed. The live
`media_assets` row itself is still mutable — a tenant can still edit its
`altText`/`storageKey` for future publishes — but an already-published
Revision no longer changes when that happens. Navigation's internal
`pageId` references are resolved (not snapshotted as ids) the same publish
turn, for the same reason a slug rename must not retroactively change an
old Revision. See
[ADR 0017](adr/0017-site-composition-kernel.md) and
[docs/PUBLISHING.md#media-v05](PUBLISHING.md#media-v05).

**v0.6 update:** Property/Unit/Amenity data stays exactly "referenced,
safely" — nothing here changes. What v0.6 adds is a **visibility filter on
the live read itself** (see "Public vs. admin visibility" above): a
Property/Unit that's no longer public is still referenced correctly by an
old Revision's frozen presentation, but the live lookup that presentation
resolves against now returns nothing for it publicly. This is the
concrete mechanism behind the worked example this section's reasoning
implies: a Property later archived stays a valid reference, but a visitor
loading that old Revision sees `DomainReferenceUnavailable`, not stale
public data for a Property the owner has since retired.

**v0.7 update:** `VirtualTour` follows exactly the "referenced, safely"
rule Property/Unit/Amenity already established — a `virtual-tour@1`
block's frozen presentation always resolves against today's live
VirtualTour row, never a snapshot of it. The same visibility mechanism
Property/Unit use (a status filter on the live read, not a copy) governs
it too: `isPublicVirtualTourStatus`/`getPublicVirtualTour`, selected by
the same `RenderContext.publicOnly` flag. See
[ADR 0019](adr/0019-virtual-tour-immersive-kernel.md).

**v0.9 update:** the frozen `MediaDescriptor` (v0.5, above) gains three new
_optional_ fields — `checksumSha256`, `byteSize`, `variants` — populated
whenever the referenced MediaAsset actually went through the real v0.9
ingestion pipeline (see [ADR 0022](adr/0022-media-ingestion-asset-delivery.md)).
A pre-v0.9 or seed-inserted MediaAsset simply lacks these fields in its
frozen descriptor, exactly like it already lacked real dimensions before —
"we don't always know" is not new, only what we don't always know grew by
three fields. `checksumSha256` doubles as the delivery URL's fingerprint;
this is what makes an already-published Revision's images fetchable
through a stable, cacheable, same-origin URL.

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
