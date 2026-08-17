# ADR 0019: Virtual Tour & Immersive Experience Kernel

## Status

Accepted.

## Context

ADR 0018 (Decision 10) audited this codebase for an existing
`VirtualTour`-shaped abstraction and found none — zero references to
virtual tours, 360° tours, or Matterport-style embeds anywhere, deferred
rather than speculatively built. The v0.7 brief asks for exactly that
abstraction now: a first-class `VirtualTour` domain entity, tied to a
Property (always) and optionally a Unit, embeddable on a Page via the
existing generic block-reference mechanism, with Matterport as the first
of a closed set of supported providers. The brief is explicit that this is
a security-sensitive surface: an iframe embed is, by construction, a
window onto arbitrary third-party content, so the entire design has to
answer "how do we let an owner embed a real 360° tour without ever letting
this become an arbitrary-content-injection primitive?" before anything
else.

## Decision 1 — VirtualTour is its own domain entity, not a MediaAsset variant

`virtual_tours` is a new table, not a new `mediaAssets.kind` value. A
MediaAsset is "a reference to a stored file" (ADR 0012) — no lifecycle
beyond existing, no external provider, no embed policy. A VirtualTour has
none of that shape: it has a `provider` + externally-hosted asset, a
business lifecycle (`draft`/`active`/`archived`, mirroring
`properties.status`/`units.status`), and an embed contract the renderer
must go through a dedicated resolution step for. Forcing it into
`mediaAssets` would mean either a nullable `provider`/`providerAssetId`
pair bolted onto every MediaAsset row (ADR 0018 Decision 4's "shared table
with mutually-exclusive optional columns" trap, rejected there for the
same reason) or a `kind: "virtual_tour"` branch scattered through every
MediaAsset consumer that assumed "resolves to a stored file." A separate
table with its own repository, its own permissions (`tour.*`, Decision 8),
and its own renderer resolution path keeps both concerns simple to reason
about independently.

## Decision 2 — Property required, Unit optional, Postgres-enforced

`virtual_tours.property_id` is `NOT NULL`; `unit_id` is nullable — the
same "a Property may, but needn't, decompose into Units" shape
`units`/`unit_sleeping_arrangements` already establish (ADR 0018 Decision
3). A whole-property tour (the entrance, garden, shared pool) and a
unit-specific tour (one bedroom's interior) are both first-class, not one
shoehorned into the other.

The Unit-belongs-to-this-Property guarantee is Postgres-enforced, not
merely application-checked — the same "composite FK, not only RLS"
defense-in-depth every prior tenant-scoped table in this codebase uses
(`docs/SITE_DOMAIN.md#ownership-consistency-db-constraints-not-only-rls`).
Under Postgres's default `MATCH SIMPLE` semantics, a composite FK is
satisfied (not checked at all) whenever any one referenced column is
`NULL` — exploited here exactly as `sites.published_revision_id` already
does (ADR 0016): `virtual_tours_tenant_property_unit_fk` on
`(tenant_id, property_id, unit_id)` referencing
`units(tenant_id, property_id, id)` is a no-op when `unit_id IS NULL`
(the Property-only case) but, whenever `unit_id` is set, requires a real
`units` row with that _same_ `tenant_id` **and** `property_id` — a Unit
belonging to a different Property, even within the same tenant, is
rejected at `INSERT`/`UPDATE` (`23503`), not merely something the
repository layer happens to also check. This required one new supporting
index, `units_tenant_property_id_uidx` (a unique `(tenant_id, property_id,
id)` index — `units` already had no index exposing `property_id` as part
of a unique key), added via a new migration statement, not a rewrite of
any historical one. Proven directly by raw-`INSERT` tests in
`packages/virtual-tours/src/virtual-tour-repository.test.ts` and
`rls.test.ts` that bypass the repository helper entirely.

Deliberately **not** added: a `unique(tenant_id, provider,
provider_asset_id)` constraint. The same physical provider asset (a
Matterport Space covering a shared amenity area) may legitimately be worth
referencing from more than one `VirtualTour` row — a Property-level tour
and a Unit-level one pointing at the same underlying space, or a
duplicated draft being iterated on before the original is archived.
Nothing in the brief requires "one row per provider asset per tenant,"
and adding that speculatively would block a legitimate reuse case for no
stated benefit.

## Decision 3 — a closed provider registry, never a generic iframe provider

`packages/virtual-tours`' `VirtualTourProviderDefinition` (provider key,
`normalize`, `validateExternalId`, `buildEmbedUrl`, optional
`buildPublicUrl`, `frameOrigins`, `capabilities`) is the single place a
provider's behavior lives — `packages/publishing`, `packages/renderer`,
and `apps/admin` call through the registry (`virtualTourProviderRegistry`)
exclusively; none of them ever branches on `provider === "matterport"`.
Adding a second provider later is "write one more definition, register
it" — no other call site changes.

This is a **closed** registry by construction, not merely by convention:
there is no "generic" provider a caller could register whose
`buildEmbedUrl` echoes back a caller-supplied URL unchanged. Every
definition is first-party code that fully controls what `src` a
VirtualTour can ever resolve to. The brief's explicit warning against a
"generic iframe provider" (an arbitrary-content-injection vector by
definition — anyone able to write a `providerAssetId`, or worse a raw
URL, into a VirtualTour row could point the public site's iframe at
anything) is enforced by this shape, not by a code-review convention that
could be forgotten later.

`matterportProvider.normalize()` closes the loop: it accepts either a
bare 11-character Model SID or the official
`https://my.matterport.com/show/?m=<sid>` share URL (older bare
`https://my.matterport.com/?m=<sid>` form also accepted), verified against
Matterport's own current Help Center documentation (via `WebSearch`, since
direct `WebFetch` to `support.matterport.com` is blocked by this
environment's egress proxy) rather than trusted from training data, per
the brief's explicit instruction. Rejected, not merely "not matched": a
different host, a lookalike subdomain
(`my.matterport.com.evil.example`) or prefix (`evil-my.matterport.com`),
any non-`https` scheme including `javascript:`/`data:`/`blob:`
(`new URL()` either throws or parses a `protocol` that fails the explicit
check), a missing/malformed `m` parameter, or a bare string that isn't a
valid-shaped SID. Any _other_ query parameter on an input URL is read,
never propagated — `buildEmbedUrl` always constructs the canonical URL
fresh from just the normalized SID, never echoes anything else back from
the original input. Proven directly by
`packages/virtual-tours/src/providers/matterport.test.ts`'s security/
normalization matrix.

## Decision 4 — `virtual-tour@1` reuses the existing generic reference mechanism, never a new one

`BlockDefinition.references`'s `domainType` widens from `"property" |
"unit"` to `"property" | "unit" | "virtualTour"` — the exact same
mechanism ADR 0017 (Decision 3) introduced and ADR 0018 (Decision 7)
already extended once. `virtual-tour@1`'s `references()` returns a
`{kind: "domain", domainType: "virtualTour", id: props.tourId}` entry
plus, when `posterMediaId` is set, a `{kind: "media", id:
posterMediaId}` entry — no new mechanism, no block-type-specific
knowledge added to `collectReferences`/`validateDomainReferences`. The
brief was explicit that a parallel reference system was out of bounds;
this decision is the direct consequence of taking that seriously.

Props: `tourId` (the reference), `showTitle` (default `true`),
`aspectRatio` (`"16:9" | "4:3"`, default `"16:9"`), `posterMediaId`
(optional — a MediaAsset shown before/behind the iframe, resolved through
the exact same frozen-manifest/live-lookup split as `hero@1`'s
`backgroundMediaId`, per `packages/renderer/src/resolve-media.ts`).

## Decision 5 — publish-time validation gains a third failure mode: `domain_reference_invalid`

`validateDomainReferences` (ADR 0018 Decision 7) already distinguishes
`domain_reference_missing` (doesn't exist / cross-tenant) from
`domain_reference_not_active` (exists, but not currently public). A
VirtualTour reference needs a third, genuinely different failure this
mechanism didn't previously need: the referenced row's `provider` might
not be a currently-registered provider, or its stored `providerAssetId`
might no longer pass that provider's own `validateExternalId` — a
defensive check against a row predating a provider's removal from the
registry (or a raw, non-repository DB edit), not a path any normal write
ever takes (`createVirtualTour`/`updateVirtualTour` always normalize
through the registry first). `domain_reference_invalid` is this codebase's
first genuinely _content-shape_ publish-blocking issue, distinct from
existence/tenant/status — kept as a separate code rather than folded into
`domain_reference_not_active`, since "not active" (`draft`/`archived`)
and "corrupted" are different problems an editor needs different guidance
for. Proven directly by `packages/publishing/src/composition.test.ts`'s
v0.7 describe block, including a raw-admin-write test that forges an
unregistered `provider` value to exercise this path (unreachable through
the repository itself).

## Decision 6 — Presentation-Frozen/Business-Live, identically to Property/Unit

A VirtualTour row is read live at render time, always — never frozen into
a Revision snapshot. Only the Block's own presentation props (`tourId`
itself, `showTitle`, `aspectRatio`, `posterMediaId`) freeze into the
Revision; the referenced row's `provider`/`providerAssetId`/`status`/
`publicName` stay entirely live, exactly the same boundary ADR 0018
(Decision 6) already established for Property/Unit. Two direct
consequences, both proven by dedicated tests in
`packages/renderer/src/render-page.test.tsx`'s v0.7 describe block:

- **An admin repointing a Tour's target asset after publish takes effect
  immediately, without a republish.** The renderer's
  `virtualTourRendererV1` calls `getVirtualTour`/`getPublicVirtualTour`
  fresh on every render — never a manifest lookup — so an unmodified,
  already-published block config renders a different embed `src` the
  moment the underlying row changes.
- **Archiving a Tour removes it from the public site immediately, without
  a republish.** `getPublicVirtualTour` (gated on
  `isPublicVirtualTourStatus`, i.e. `status === "active"`) is what
  `RenderContext.publicOnly: true` selects; setting `status: "archived"`
  makes the very next public request render `DomainReferenceUnavailable`
  for that block, with zero interaction with the Page/Block/Revision at
  all — the same mechanism, not a special case, as an archived Property
  disappearing from public view mid-Revision.

## Decision 7 — `SafeVirtualTourEmbed`: the renderer never reconstructs provider logic

`packages/virtual-tours`' `buildSafeVirtualTourEmbed(tour)` is the one
place a stored `{provider, providerAssetId}` becomes a renderable
descriptor (`{provider, src, publicUrl?, allowFullscreen, iframeAllow?}`).
`packages/renderer`'s `virtual-tour.tsx` consumes only this descriptor —
it never touches `provider`/`providerAssetId` directly, never constructs
a URL itself, never contains a provider-specific `if`. `src` is always
the provider's own deterministic, first-party-constructed URL (Decision
3); `iframeAllow` is passed through verbatim from the provider's declared
`capabilities.iframeAllow` (Matterport's official embed snippet specifies
`allow="xr-spatial-tracking"` — copied from the source of truth, never
guessed by the renderer). This layering is what makes "the renderer
cannot become an injection vector even if a future provider is sloppy"
true by construction rather than by discipline: the renderer's contract
with `packages/virtual-tours` is a plain descriptor object, not a
provider's raw stored fields.

No `dangerouslySetInnerHTML`, no stored HTML/iframe string, anywhere in
this feature — `<iframe src={embed.src} ...>` is a normal React element
with a string prop, rendered `loading="lazy"`, `allowFullScreen`,
inside a responsive (intrinsic-ratio `padding-bottom`) container that
never depends on the iframe's own reported size.

## Decision 8 — `tour.read`/`create`/`update`/`delete`, not `media.*`

A new, dedicated permission namespace, granted to `owner`/`admin` (all
four) and `member` (`tour.read` only) — the exact same shape
`property.*`/`unit.*` already have. Deliberately **not** folded into
`media.*`: a VirtualTour is a domain entity with its own ownership,
composite-FK, and publish-reference semantics (like Property/Unit), not a
MediaAsset (Decision 1) — reusing `media.*` would conflate two unrelated
permission surfaces for a resource that isn't actually a MediaAsset.

## Decision 9 — CSP `frame-src`, a literal kept in sync by a dedicated test

Both `apps/web/next.config.mjs` and `apps/admin/next.config.mjs` gain a
`headers()` function setting `Content-Security-Policy: frame-src
<provider origins>` on every route. Two things worth being explicit
about:

- **Only `frame-src` is set — no other directive.** `next.config.mjs` is
  loaded directly by Node, before Next's own build/TypeScript pipeline
  exists, so it cannot import `packages/virtual-tours` (a raw-TypeScript
  workspace package) the way application code does; the origin list is a
  literal. A broader CSP (a nonce-based `script-src`, etc.) would require
  either forcing fully dynamic rendering (this codebase's pages are
  otherwise cacheable) or breaking the pervasive existing use of inline
  `style={{...}}` React props (`style-src 'unsafe-inline'` would be
  required everywhere, defeating the point). Scoping to exactly
  `frame-src` avoids both problems while still closing the actual gap the
  brief asked for: no `<iframe>` on either app can ever load a
  non-allowlisted origin, regardless of what a future bug in
  `buildEmbedUrl` might produce.
- **The literal is enforced by a test, not by hoping someone remembers to
  update two files.** `packages/virtual-tours/src/csp-frame-origins.test.ts`
  dynamically imports both `next.config.mjs` files, calls their
  `headers()`, and asserts the parsed `frame-src` origin set matches
  `listAllProviderFrameOrigins()` — the live provider registry. A provider
  added to the registry without updating both `next.config.mjs` literals
  fails this test, loudly, at `pnpm test` time, not silently in
  production. No wildcards anywhere in the value.

## Decision 10 — deliberate non-decisions

Per the brief's own instruction to decide explicitly rather than add
speculative scope:

- **No click-to-load.** Documented as a real, deferred consideration (a
  poster image + explicit click before the iframe mounts would reduce
  third-party network/cookie exposure until a visitor opts in) — not
  implemented, since nothing in the brief requires it and building it
  without a concrete UX spec would be guessing. `posterMediaId` exists
  precisely so a future click-to-load implementation has zero schema
  migration to do.
- **No `sandbox` attribute on the `<iframe>`.** Matterport's own official
  embed snippet specifies none; guessing a `sandbox` value without the
  ability to live-test against Matterport's actual Showcase JavaScript
  (which needs same-origin-ish capabilities to function — script
  execution, and typically `allow-same-origin`) risks either breaking the
  embed or providing false security confidence. The CSP `frame-src`
  allowlist (Decision 9) is the real, verified boundary here — it fully
  answers "can this page ever load a non-Matterport origin in a frame,"
  which is the actual threat this feature introduces.
- **No cross-Site validation for VirtualTour references.** Matches the
  existing Property/Unit precedent exactly (ADR 0017/0018): a reference is
  checked for tenant ownership and public status, never for "does this
  Property/Unit/Tour belong to _this specific Site_" — the same
  deliberately-deferred scope, unchanged.
- **No Matterport SDK, API key, OAuth flow, GraphQL client, or webhook
  integration anywhere.** The entire feature is a deterministic, static
  URL construction from an admin-supplied identifier — no runtime
  dependency on Matterport beyond the public embed URL itself. Verified
  directly: `grep`-based checks confirming no such dependency was
  introduced (`package.json` diffs, source-wide search for API-key-shaped
  strings/SDK imports) are part of this change's own pre-commit review.

## Consequences

- Migration `0013_virtual_tour_immersive_kernel.sql` (drizzle-kit
  generated, manually reordered so `units_tenant_property_id_uidx` is
  created before the composite FK that depends on it — Postgres requires
  the referenced unique index to already exist) plus a hand-written
  `0014_v07_virtual_tour_role_grants.sql` (declarative `provence360_app`
  grants), the same split every prior schema-then-grants migration pair
  in this repo uses.
- A new package, `@provence360/virtual-tours` — provider registry,
  Matterport adapter, repository (ownership checks, optimistic
  concurrency, public/live read split), and the `SafeVirtualTourEmbed`
  descriptor layer. Consumed by `packages/content` (the block schema),
  `packages/publishing` (domain-reference validation), and
  `packages/renderer` (the block renderer) — never the reverse.
- `packages/renderer` gains its first dependency reaching outside
  `@provence360/rentals` for domain data (`@provence360/virtual-tours`) —
  a deliberate, narrow addition mirroring the existing Rentals dependency
  shape exactly, not a new architectural pattern.
- Booking, pricing, availability, and every other out-of-scope area this
  codebase already excludes remain untouched — this feature is
  presentation/embedding only, exactly as scoped.
