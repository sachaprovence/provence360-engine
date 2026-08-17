# ADR 0018: Rental Domain & Guest Experience Kernel

## Status

Accepted.

## Context

v0.3 gave `packages/rentals` a minimal Property/Unit/Amenity model — enough
to prove the Rental domain existed and to bind content blocks to it, but
far short of what a real short-term-rental listing needs, and with a real
public-visibility gap: nothing anywhere filtered a Property by its own
`status`, and only `unit-grid.tsx` filtered Units (inline, ad hoc). The
v0.6 brief asked for four things at once: richer guest-facing Property/Unit
data (arrival/departure times, house policies, structured sleeping
arrangements, location privacy), Property-level Amenities (previously
Unit-only), a real public/admin visibility boundary, and hardened
publish-time validation — without disturbing v0.4/v0.5's Presentation-
Frozen/Business-Live boundary or v0.5's media-freezing/reference mechanism.
Booking, pricing, availability, and payment are explicitly out of scope.

## Decision 1 — new Property/Unit fields are flat columns, not JSONB

`checkInTime`/`checkOutTime`/`quietHoursStart`/`quietHoursEnd` are native
Postgres `time` columns (not `text`): locale-independent by construction,
validated by Postgres itself, and comparable/sortable if ever needed —
unlike navigation (ADR 0017), these are stable domain facts with a fixed
shape, not polymorphic per-tenant configuration, so the JSONB reasoning
that applies to `navigation`/`themeOverrides` doesn't apply here.

`smokingPolicy`/`petsPolicy`/`eventsPolicy` are nullable text enum columns
holding a **tri-state**, not a boolean: `allowed | not_allowed | on_request`.
Collapsing this to a boolean would either lose `on_request` (a real,
common state in short-term rental listings) or conflate "not specified by
the owner" with "explicitly not allowed" — this codebase already rejects
that conflation for numeric fields (`units.maxGuests`/`bedrooms`, always
nullable, never a `0` sentinel), and the same "unknown ≠ a specific value"
principle applies here. Nullable, not defaulted: silence from an owner
must stay silence, not become a fabricated "not allowed."

`quietHoursStart`/`quietHoursEnd` deliberately have **no ordering CHECK** —
a quiet window commonly wraps midnight (22:00 → 08:00), which is the
normal case, not an edge case; only "both set or both null" is enforced
(`properties_quiet_hours_pair_ck`, same shape as the pre-existing
`units_size_requires_unit_ck`).

## Decision 2 — location privacy is a disclosure enum, enforced server-side

`properties.locationDisclosure` (`exact | approximate | hidden`, `NOT NULL
DEFAULT 'exact'`) governs what a **guest** — never what the owner — sees of
a Property's address. Defaulting to `exact` is deliberate: every already-
seeded Property's already-rendered address must keep rendering unchanged
after this migration; a silent behavior change on upgrade (addresses
suddenly disappearing) would be worse than requiring an explicit opt-in to
hide one.

Enforcement is **defense-in-depth at the data-shaping layer**, not a UI
toggle: `packages/rentals/src/guest-view.ts`'s `buildPropertyGuestView`
takes a `publicView` flag and, when true, structurally omits (never nulls,
never blanks — omits the key) whatever the disclosure level doesn't allow:
`approximate` keeps city/region/country only; `hidden` keeps nothing
location-related beyond the disclosure flag itself. A renderer that forgets
to check disclosure cannot leak the address, because the private fields
were never present in the object it received — the same "refused
server-side, not just UI-hidden" posture this codebase already applies to
authorization (`docs/AUTHORIZATION.md`). `publicView: false` (the admin/
preview path) always sees the full address regardless of disclosure — that
setting governs what _guests_ see, not what an owner can see of their own
data. Proven directly by `packages/rentals/src/guest-view.test.ts`'s
anti-leak tests (asserting the serialized JSON never contains the private
substring, not just checking a specific field) and
`packages/renderer/src/render-page.test.tsx`'s rendered-HTML equivalent.

## Decision 3 — structured sleeping arrangements, hybrid aggregates-vs-detail

`unit_sleeping_arrangements` is a new relational table (tenant-scoped,
composite-FK'd to `units`, full CRUD RLS), not JSONB: each row needs a
stable identity for individual create/update/delete (the brief's explicit
requirement), a genuinely ordered list (`ordering`, same pattern as
`units.ordering`), and a real `quantity > 0` CHECK — none of which JSONB
expresses as cleanly as `themeOverrides`/`navigation`'s document shape
does.

`units.beds` (the pre-existing raw integer) is **not removed or
deprecated** — it becomes the fallback. `packages/rentals/src/guest-view.ts`'s
`buildUnitGuestView` computes `effectiveBedCount`: the sum of
`sleepingArrangements`' quantities when any detail rows exist for that
Unit, otherwise the raw `beds` column. The two are never both present in
the returned view — a caller cannot accidentally display "beds: 3" next to
"detail sums to 5," because only one of them is ever computed and exposed.
This is a deliberate choice not to reconcile or validate the two against
each other at write time (no CHECK, no trigger): a Unit with detail rows
that don't sum to its `beds` column is not an error, it's just a Unit
whose `beds` value is stale/advisory, exactly as if it had never been
updated after gaining detail.

## Decision 4 — Property-level Amenities mirror Unit-level exactly

`property_amenities` is structurally identical to the pre-existing
`unit_amenities` (same composite-FK-to-parent pattern, same unique
`(parent_id, amenity_id)` index, same RLS shape) — a second table, not a
nullable `unitId | propertyId` column bolted onto `unit_amenities`. A
shared table with two mutually-exclusive optional parent columns would
need an additional CHECK to enforce "exactly one of these is set" and
would make every RLS policy and composite FK on that table harder to
reason about for no real benefit; two small, identically-shaped tables are
simpler to verify individually. Both reuse the same global, non-tenant-scoped
`amenities` catalog — no separate "Property amenity catalog" was created,
per the brief's explicit warning against this.

## Decision 5 — amenity metadata gets real, minimal validation

`unit_amenities.metadata`/`property_amenities.metadata` (JSONB) existed
since v0.3 but had **zero validation and, in practice, no write path that
ever set it to anything but `{}`** — confirmed by the pre-v0.6 audit:
`setUnitAmenities` never accepted a metadata argument at all. v0.6 adds
`amenityMetadataSchema` (`packages/rentals/src/validation.ts`): a small,
closed, `.strict()` shape — `{ featured?: boolean, note?: string }` —
applied uniformly to both tables via `setUnitAmenities`/`setPropertyAmenities`'s
new optional `{ amenityId, metadata }` input shape (backward compatible: a
bare amenity-id string still works, defaulting to `{}`). Deliberately
**not** a per-amenity-category schema registry (e.g. a different shape for
`pool` vs. `wifi`) — the brief explicitly warns against building "un
framework générique énorme" for this, and nothing in this codebase's
actual amenity usage needs more than a shared, tiny shape.

## Decision 6 — public-vs-admin Rental visibility: named predicates, a

projection layer, and one new RenderContext flag

Confirmed by the pre-v0.6 audit: there was no public/admin read
separation anywhere in `packages/rentals` — every function (`getProperty`,
`getUnit`, `listUnitsForProperty`, `listAmenitiesForUnit`) was called
identically by admin pages and public renderer blocks, and only
`unit-grid.tsx` applied any status filter, inline, duplicated nowhere else.
`property-summary.tsx` and `amenities.tsx` applied **none** — an archived
Property still rendered its full public name/address on the public site
even though its own PropertyDetail admin page called it "archived."

v0.6 closes this with three layers, each independently testable:

1. **Named status predicates**, exported from the repositories that own
   the enum: `isPublicPropertyStatus` (`status === "active"`) and
   `isPublicUnitStatus` (`active` or `not_bookable_separately` — this
   second value is the pre-existing render-time filter, now named and
   centralized instead of re-implemented). A draft Property/Unit is never
   public; an archived one likewise never is — the worked example from the
   brief (a Property later archived while a Revision's frozen presentation
   still references it) is exactly what these predicates make impossible
   to leak through the live read path.
2. **Public-scoped read functions** built on top of the unrestricted
   ones: `getPublicProperty`/`getPublicUnit`/`listPublicUnitsForProperty`
   — never a duplicated query, only a status filter layered on the
   existing tenant-scoped read.
3. **`RenderContext.publicOnly?: boolean`** (renderer), the direct sibling
   of v0.5's `RenderContext.media` — same "one optional flag switches
   published-public vs. draft-preview behavior" shape, deliberately a
   separate flag rather than reusing `media`'s presence as an implicit
   dual-purpose signal (a page can have frozen media before the Property
   it references is even active; the two concerns are orthogonal).
   `apps/web/lib/site-page.ts` sets it `true` — every request reaching
   that pipeline is a real public visitor; `apps/admin`'s Draft preview
   page never sets it, unchanged.

`property-summary.tsx`/`amenities.tsx` now call the new
`getPropertyGuestView`/guest-view-aware lookups with `{ public:
context.publicOnly === true }` and render `DomainReferenceUnavailable`
when that resolves to `null` — the same graceful-degradation contract
`docs/RENDERING.md#error-handling` already establishes for a missing/
cross-tenant reference, now also covering "exists, tenant-owned, but not
currently public." `unit-grid.tsx` keeps its pre-existing unconditional
status filter (now via the named `listPublicUnitsForProperty`/predicate
rather than an inline duplicate) — this was already correct pre-v0.6 and
needed no behavior change, only de-duplication.

Proven directly: `packages/rentals/src/unit-repository.test.ts` and
`property-repository.test.ts`'s new visibility describe blocks;
`packages/renderer/src/render-page.test.tsx`'s "public vs preview Rental
visibility" describe block, including the explicit Presentation-Frozen/
Business-Live test (identical, unmodified block props render differently
before and after the referenced Property is archived); and
`apps/web/e2e/rentals.spec.ts`'s equivalent HTTP-level scenario.

## Decision 7 — publish-time domain-reference validation gains an

active-status check, and one deliberate non-check

v0.5's `validateDomainReferences` was not a bug relative to what it
documented itself as doing (existence + tenant only) — but it left a real
gap: nothing stopped a page from being published bound to rental data that
would immediately render as `DomainReferenceUnavailable` to every visitor.
v0.6 adds a new `domain_reference_not_active` issue code, distinct from
`domain_reference_missing`, checking the same `isPublicPropertyStatus`/
`isPublicUnitStatus` predicates from Decision 6. This is a deliberate
publish-time **UX improvement** (fail fast, at edit time), not a
correctness fix to the runtime boundary — an already-published Revision
whose referenced Property is later archived is entirely unaffected by this
change; its presentation stays frozen, and the live read (Decision 6)
already stops surfacing it.

**Deliberately not validated**: whether a `unit-grid` block's explicit
`unitIds` actually belong to its own declared `propertyId`. Adding that
would require `validateDomainReferences` — which only ever sees a flat,
block-type-agnostic `{domainType, id}` list (`collectReferences`) — to
gain block-type-specific knowledge, exactly the central-switch design
Decision 3 of ADR 0017 was built to avoid. It's safe to defer: the
renderer already fails closed here today — `unit-grid.tsx` only ever
selects from Units it already fetched scoped to `props.propertyId`, so a
stray cross-Property `unitId` simply never appears in the rendered output,
never wrongly displayed.

## Decision 8 — optimistic concurrency extended to Property/Unit,

Not Found preserved over Forbidden, audit logging per mutation

`updateProperty`/`updateUnit` gain the same opt-in `expectedUpdatedAt` /
`*ConflictError` pattern `packages/sites`/`packages/content` already use
(`eqUpdatedAtMs`, millisecond-truncated compare-and-swap, a
still-exists-but-stale-token check to distinguish `*ConflictError` from
`*NotFoundError`) — omitted by a caller, the pre-v0.6 unconditional
last-write-wins behavior is unchanged, so this is purely additive.
`SleepingArrangementNotFoundError` mirrors the "not found" phrasing every
other domain error in this package already uses (never leaking whether a
cross-tenant row exists vs. genuinely doesn't). Every new mutation
(`createSleepingArrangement`/`updateSleepingArrangement`/
`deleteSleepingArrangement`) records an audit-log entry, matching the
per-mutation granularity `PROPERTY_CREATED`/`UNIT_UPDATED`/etc. already
establish.

## Decision 9 — block schema evolution stays on `@1`, no version bump

`property-summary@1`/`unit-grid@1`/`amenities@1` all gain new, optional,
defaulted-`false` props (`showCheckInOut`, `showPolicies`,
`showBedSummary`) — an already-stored instance that never set these keeps
rendering exactly as before, so this is non-breaking by construction, not
a reason to bump to `@2`. `amenities@1`'s widening is slightly larger
(`unitId` becomes optional, `propertyId` is added, exactly one must be
set) but is equally non-breaking: every pre-v0.6 stored instance always
has `unitId` set and `propertyId` omitted, which still satisfies the new
`.refine`. The one behavioral nuance is `property-summary`'s existing
`showAddress` prop: its _rendering meaning_ becomes disclosure-aware
(Decision 2) without its _schema_ changing at all — the same precedent
v0.5 already set for `hero@1` switching to frozen media (ADR 0017,
Decision 4): only the data _source_ changed, never the props shape. This
was audited directly: zero existing precedent anywhere in this codebase
for two coexisting versions of the same block type, so v0.6 deliberately
avoids becoming the first case where it isn't strictly required.

## Decision 10 — Virtual Tours: audited, deliberately deferred

The brief's section 19 explicitly required auditing for an existing
`VirtualTour`-shaped abstraction before deciding to defer it. A full
search (schema, content blocks, renderer, docs) found zero references to
virtual tours, 360° tours, or Matterport-style embeds anywhere in this
codebase — there is no existing abstraction to extend, clean or
otherwise. Building one from scratch is out of scope for a Guest
Experience kernel whose brief explicitly bounds it to arrival/departure,
policies, sleeping arrangements, amenities, and location privacy; deferred
to a future mission rather than speculatively designed here.

## Consequences

- Migration `0011_rental_guest_experience_kernel.sql` (drizzle-kit
  generated: new columns, two new tables, RLS policies, CHECK constraints)
  plus a hand-written `0012_v06_rental_guest_experience_role_grants.sql`
  (declarative `provence360_app` grants for the two new tables — the same
  split every prior schema-then-grants migration pair in this repo uses,
  since an RLS policy alone grants nothing without a matching table-level
  GRANT, per ADR 0008). Both verified against a real, fresh-then-upgraded
  dev database, not just unit-tested in isolation.
- `packages/renderer` still has no dependency on `packages/publishing` or
  `packages/rentals`' internal repository modules beyond its existing
  `@provence360/rentals` dependency (unchanged from v0.3) — `RenderContext.publicOnly`
  is a plain boolean, no new cross-package coupling.
- `packages/testkit`'s `resetDatabase()` and factories gained the two new
  tables/fields; every new tenant-scoped table has real-Postgres RLS tests
  (`packages/rentals/src/rls.test.ts`) exercised via raw queries against
  `provence360_app`, independent of any repository function ever getting
  ownership checks right.
- Booking, pricing, availability, calendars, and payment remain entirely
  out of scope, as the brief mandated — no schema, no code path, no admin
  UI anywhere in this change touches any of them.
