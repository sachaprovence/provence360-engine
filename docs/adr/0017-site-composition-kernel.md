# ADR 0017: Content & Site Composition Kernel

## Status

Accepted.

## Context

v0.4 shipped `Draft → Validation → Immutable Revision → Publication →
Public Runtime` (ADR 0016), but its `SiteSnapshot` had two real gaps the
v0.5 brief asked to close:

- `SiteSnapshot["site"]["navigation"]` was typed `unknown` — the raw
  `sites.navigation` JSONB value, copied into every Revision with zero
  validation and zero write path (nothing in `packages/sites` ever set it
  to anything but the column's own `[]` default before v0.5 — see
  `docs/SITE_DOMAIN.md`'s own admission that it was "intentionally loose").
- Every stored `site_revisions.snapshot` was read back with
  `revision.snapshot as SiteSnapshot` (`published-revision.ts`,
  `draft-service.ts`) — a compile-time-only assertion the database round
  trip could silently violate, not a runtime check.

This ADR is the v0.5 design: a typed, versioned Site Composition Contract
covering navigation, page/media/domain references, and the snapshot
document itself.

## Decision 1 — navigation is a typed contract, still JSONB

`packages/content/src/navigation.ts`'s `navigationSchema` replaces the
opaque field with a closed, Zod-validated shape: `{ version: 1, items:
NavigationItem[] }`, each item a stable `id`, a `LocalizedString` label,
and a discriminated `target` (`{ kind: "page", pageId }` or `{ kind:
"external", href, newTab? }`), with bounded depth (2 levels), bounded
item counts, and globally-unique ids enforced via a `superRefine` tree
walk (Zod's recursive-schema support alone can express the shape but not
these cross-node invariants).

**Storage stays JSONB, not a new table.** The reasoning is identical to
`themeOverrides`'/`pages.content`'s (ADR 0013): navigation is a small,
whole-document, no-independent-query-pattern structure — nothing ever
needs "find all Sites whose navigation contains X" as a query, only "read
this Site's navigation, validated." A relational model (a `navigation_items`
table with parent/child rows) would buy nothing here and cost a join on
every read. `docs/SITE_DOMAIN.md`'s existing "ownership consistency: DB
constraints, not only RLS" section already draws this line for `pages.content`'s
block references — navigation is the same shape of problem.

**Structural vs. referential validation are two different layers, on
purpose** (section 12 of the brief): `packages/sites`' new
`updateSiteNavigation` runs `navigationSchema.parse` at write time — it
can confirm the shape is well-formed and every `pageId` is a syntactically
valid UUID, but it _cannot_ confirm that UUID names a real Page of this
Site (JSONB has no foreign key). That referential check is deferred to
publish time, inside `assembleDraft`'s single pass (see Decision 2) — the
one place that already holds a consistent, race-safe view of both the
Draft's navigation and its Pages.

## Decision 2 — Draft refs vs. Published resolved refs

A Draft's navigation addresses Pages by **stable `pageId`**, never by
slug — the same reasoning `pages.content`'s block props never embedded a
Page's slug. A Revision's navigation instead holds the **resolved route**:
`{ kind: "page", slug }`. Resolution happens exactly once, inside
`assembleDraft` (`packages/publishing/src/resolve-navigation.ts`'s
`resolveNavigation`), against the exact same in-memory list of the Site's
active Pages `assembleDraft` already loaded for its own page loop — zero
extra queries, so this can't race a concurrent edit the way two separate
reads could (docs/PUBLISHING.md#concurrency).

This is what makes an already-published Revision immune to a later Draft
change: renaming a Page's slug, or deleting the Page navigation pointed
at, only affects the _next_ publish's resolution — a currently-live
Revision's navigation was already resolved and frozen the moment it was
created. Tested directly in `packages/publishing/src/composition.test.ts`'s
"Immutability" describe block.

A `pageId` that doesn't resolve — nonexistent, belongs to a different Site,
belongs to a different Tenant, or names a Page that's `draft`/`archived`
(and therefore excluded from this publish) — is a single
`navigation_page_not_found` issue. These four causes are deliberately
indistinguishable: `publishablePages` is already scoped to this Site/
Tenant's _active_ Pages only, so a lookup miss is the same "absent, not a
leak" contract every other tenant-scoped lookup in this codebase uses
(docs/RENDERING.md#security).

## Decision 3 — a generic block-reference mechanism, not a central switch

`packages/content`'s `BlockDefinition` gained one new, optional field:

```ts
references?: (props: TProps) => readonly BlockReference[];
```

Each block declares its own references — Hero's `backgroundMediaId`,
Gallery's `mediaAssetIds`, PropertySummary/UnitGrid's `propertyId`,
UnitGrid's `unitIds`, Amenities' `unitId` — as a `{ kind: "media" | "domain",
domainType?, id }` list. `extractBlockReferences` (parse-block.ts) is the
one place that calls it, via the same registry lookup `parseBlockInstance`
already uses. A future block type declares its own `references` and needs
no change to `packages/publishing`'s composition pipeline at all — the
alternative (a big `switch (block.type)` inside `assembleDraft` that has to
know every block by name) was explicitly rejected by the brief.

## Decision 4 — media: Presentation frozen, Business live (extended to media)

v0.4's own boundary (ADR 0016, `docs/SITE_DOMAIN.md#future-release-compatibility`)
already drew the line for Property/Unit/Amenity data: business facts stay
live even under an old Revision. v0.5 extends the _frozen_ side of that
line to media metadata, which v0.4 never addressed — `hero.tsx`/`gallery.tsx`
always did a **live** `listMediaAssetsByIds(context.tx, ...)` lookup, even
when rendering an already-published Revision, meaning an old Revision's
images could silently change if the underlying `MediaAsset` row's
`storageKey`/`altText` was edited later. That was never a deliberate
design choice — it was simply unaddressed.

`packages/publishing/src/media-manifest.ts`'s `resolveMediaManifest` now
runs inside `assembleDraft`: it collects every media id any block/SEO
field on the publishable pages references (via Decision 3's mechanism,
plus each Page's `seo.ogImageMediaId`), resolves them under the current
tenant context (`listMediaAssetsByIds` — already tenant-scoped), and
freezes a deduplicated, id-sorted `MediaDescriptor[]` (id, kind,
storageKey, mimeType, width, height, altText — never the binary itself)
into the snapshot's new `media` field.

A referenced id that doesn't resolve — genuinely missing, or (by the same
indistinguishable-by-design contract as navigation) belonging to another
tenant — is a `media_reference_missing` publish-blocking issue, not a
silent omission: unlike the _render-time_ "stale id resolves to nothing,
degrade gracefully" contract domain-bound blocks already use, a broken
reference must be caught _before_ an immutable Revision freezes it, never
discovered later by a visitor loading a missing image forever after.

**The renderer's own change is minimal and structural, not business
logic** (section 17 of the brief): `RenderContext` gained one optional
field, `media?: ReadonlyMap<string, FrozenMediaDescriptor>`. When present
(rendering a published Revision — `apps/web`'s `renderPublishedPage`
builds it from `snapshot.media`), Hero/Gallery resolve from it, never
`tx`. When absent (rendering a Draft preview — `apps/admin`'s preview
page never sets it), they fall back to the pre-v0.5 live lookup exactly
unchanged, which is the semantically _correct_ behavior for a preview (it
must show today's draft media). `packages/renderer/src/resolve-media.ts`
is the one place this branch lives, shared by both blocks.

**Domain references get a lighter check, deliberately not a freeze**
(section 10): `validateDomainReferences` confirms a referenced
`propertyId`/`unitId` exists for the current tenant at publish time — a
`domain_reference_missing` issue on failure — but copies nothing about
that row into the snapshot. This is intentionally the smallest possible
extension of the existing invariant: it catches "this reference is
manifestly broken right now," it does not start freezing Rental domain
data, which v0.4 explicitly and correctly left live.

## Decision 5 — snapshot schema versioning and legacy compatibility

`packages/publishing/src/site-snapshot.ts` introduces `schemaVersion: 2`
and `parseSiteSnapshot(raw): SiteSnapshot` — the one runtime trust
boundary every stored snapshot passes through, replacing both
`revision.snapshot as SiteSnapshot` casts. `schemaVersion` selects the
validation path:

- **`2`** (or a mismatched, unrecognized number): validated in full
  against `siteSnapshotV2Schema` (a real Zod object — `navigation`,
  `media`, `pages[].content` as `blockEnvelopeSchema[]`, `theme.tokens` as
  the closed `themeTokensSchema`). An unrecognized version throws
  `UnknownSnapshotVersionError` — deterministic and fail-closed, per
  section 7's explicit instruction, never a fallback to the Draft.
- **absent** (every v0.4 Revision — that format never had the field):
  validated against a separate, strict `legacySiteSnapshotSchema` (every
  field it always had, still fully checked — `navigation` alone stays
  `z.unknown()` since it was never itself validated at the time), then
  normalized: `navigation` becomes `EMPTY_RESOLVED_NAVIGATION` (a v0.4
  Revision's raw `navigation` value was never validated and never had its
  `pageId`s resolved against _that Revision's_ Pages — there is no
  principled reconstruction, and nothing in v0.4 ever rendered
  `site.navigation` anyway, so this is formalizing an existing no-op, not
  a regression), and `media` is **omitted entirely**, not set to `[]`.

That last distinction is load-bearing: `media: []` (a real v2 Revision
with nothing referenced) and `media` absent (a legacy Revision with no
frozen manifest at all) mean different things to the renderer — see
Decision 4. Both `getPublishedRevision` and `getDraftSummary` catch a
`parseSiteSnapshot` failure and treat it exactly like a dangling pointer
(log a warning, return `null`/skip the comparison) — never a 500, never
propagated up to break a page.

## Decision 6 — the public runtime resolves any published Page, not only home

`apps/web/app/page.tsx` (root-only) is replaced by
`apps/web/app/[[...slug]]/page.tsx` (an optional catch-all). This is a
necessary consequence of Decision 2, not a scope-creep addition: a
resolved internal navigation link has to go _somewhere_ real, and before
v0.5 the public runtime could only ever render `/`. The route looks the
requested Page up inside the already-parsed, already-published
`SiteSnapshot["pages"]` array by `slug` — never a fresh `pages` table
query — so this adds no new draft-read surface, only a new _published_
one. `apps/web/lib/site-page.ts`'s `renderPublishedPage` is the shared
pipeline both the page component and `generateMetadata` call (wrapped in
React's `cache()` so they share one DB round trip per request).

## Decision 7 — SEO takes its data from the Revision, not the Draft

`generateMetadata` (`app/[[...slug]]/page.tsx`) reads `title`/`description`/
`canonicalPath`/`noIndex`/`noFollow`/`ogImageMediaId` from the _resolved_
Page's `seo` field inside the published snapshot — the existing
`seoSchema` contract (unchanged, still validated at Page-write time) is
now actually wired into rendered output for the first time; before v0.5
it was validated but never read by anything. `ogImageMediaId` resolves
against the Revision's own frozen `media` manifest, the same as any other
media reference (Decision 4) — never a live lookup. Deliberately not
extended beyond this small, closed set (section 15 of the brief): no
structured data, no sitemap, no analytics.

## Consequences

- `sites.navigation`'s pre-v0.5 write path (nonexistent) meant no real
  Site ever had anything but `[]` in that column — `parseDraftNavigation`'s
  one legacy-tolerance case (a bare empty array normalizes to
  `EMPTY_NAVIGATION`) is not a hypothetical; it is every pre-v0.5 Site's
  actual, literal state.
- Hero/Gallery's frozen-vs-live media branch is the one place
  `packages/renderer` now depends on a shape "shaped like"
  `packages/publishing`'s `MediaDescriptor`/`ResolvedNavigation` without
  actually importing that package (`RenderContext.media`'s
  `FrozenMediaDescriptor`, `render-navigation.tsx`'s
  `RenderableNavigation`) — deliberate: `packages/renderer` has no
  dependency on `packages/publishing` in the existing dependency graph
  (docs/ARCHITECTURE.md), and TypeScript's structural typing makes an
  explicit import unnecessary for this to type-check correctly.
- No new migration was needed (`packages/database/migrations/` still ends
  at `0010`). Every new invariant here is either (a) genuinely
  unenforceable by Postgres from inside a JSONB document — a `pageId`/
  media id/domain id reference — and is therefore validated at the
  application boundary the same way `pages.content`'s existing block
  references already are (`docs/SITE_DOMAIN.md#ownership-consistency-db-constraints-not-only-rls`
  explicitly calls this "the one deliberate compromise" for exactly this
  class of reference), or (b) a pure shape/version tag on the same
  `jsonb("navigation")`/`jsonb("snapshot")` columns that already existed —
  nothing here needed a new column, table, or constraint.
