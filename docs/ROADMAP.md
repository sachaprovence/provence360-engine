# Roadmap

## What Foundation v0.1 is

The tenancy model, the security boundary (Postgres RLS, three-role
defense-in-depth), and the hostname resolution pipeline
(`Host -> DomainResolver -> Site -> Tenant`), proven by tests that exercise
a real Postgres database and a real running Next.js server. Nothing more.

## What Foundation v0.2 adds

Real, self-hosted authentication and tenant-scoped authorization on top of
v0.1's foundation, without touching any of its guarantees — no RLS policy
weakened, no tenant isolation test removed, no default tenant introduced:

- **Authentication** — email + password, argon2id, opaque database-backed sessions, DB-backed login rate limiting. See [docs/AUTHENTICATION.md](AUTHENTICATION.md), [ADR 0006](adr/0006-authentication-strategy.md), [ADR 0007](adr/0007-session-strategy.md).
- **Authorization** — a permission catalog per `MembershipRole`, `withAuthorizedTenantContext` as the single chain from session to RLS-scoped transaction, the owner invariant, Not-Found-over-Forbidden. See [docs/AUTHORIZATION.md](AUTHORIZATION.md).
- **A fourth Postgres role**, `provence360_auth`, narrow and column-restricted like the resolver role — and the resolver's own grants moved from a hand-maintained script into a versioned migration. See [ADR 0008](adr/0008-domain-resolver-grant-hardening.md).
- **A real (if minimal) Control Plane** in `apps/admin` — login, a tenant switcher, and per-tenant sites/domains/members/audit views, every route re-checking Membership server-side rather than trusting the URL.
- **The platform-admin/tenant-owner boundary documented**, with no UI built yet — see [ADR 0009](adr/0009-platform-admin-vs-tenant-owner.md).

## What Foundation v0.3 adds

The Site Domain, the Content Graph, and a shared renderer — turning the
tenancy/security/auth foundation into an engine that actually presents
seasonal-rental sites, without touching any prior guarantee (no RLS policy
weakened, no cross-tenant test removed, no existing migration modified):

- **The Rental domain** — `Property`, `Unit`, `Amenity` (a governed catalog), `MediaAsset` (a reference, not an upload pipeline). See [docs/SITE_DOMAIN.md](SITE_DOMAIN.md), [ADR 0010](adr/0010-property-unit-ownership.md), [ADR 0012](adr/0012-media-asset-and-amenity-catalog.md).
- **The Content Graph** — `Page` + a validated JSONB block document + a closed, versioned Block Registry (8 built-in blocks: Hero, Text, Gallery, FeatureList, PropertySummary, UnitGrid, Amenities, CTA). See [docs/CONTENT_MODEL.md](CONTENT_MODEL.md), [docs/BLOCK_SYSTEM.md](BLOCK_SYSTEM.md), [ADR 0013](adr/0013-page-content-storage.md), [ADR 0014](adr/0014-block-registry-versioning.md).
- **Themes** — a closed, semantic design-token catalog; a Site picks a shared base Theme and narrowly overrides it, never forks it. See [docs/THEMES.md](THEMES.md), [ADR 0011](adr/0011-theme-token-model.md).
- **A shared renderer** (`packages/renderer`) — the exact same code renders every seeded Site; no per-client component, ever. See [docs/RENDERING.md](RENDERING.md).
- **Localization foundations** — `LocalizedString` embedded in block props, with a fallback-resolution chain; no translator UI or per-locale routing yet. See [docs/LOCALIZATION.md](LOCALIZATION.md), [ADR 0015](adr/0015-localization-storage.md).
- **A minimal, technical Site Editor** in `apps/admin` — pages, block add/edit/remove/reorder, Property/Unit/Amenity management, theme selection and overrides. Deliberately sober (no drag-and-drop) — it validates the model, not a finished editing product.
- **Composite foreign keys** as a second, database-level ownership layer on top of RLS for every new tenant-scoped table — see [docs/SECURITY.md](SECURITY.md#defense-in-depth).
- **New permissions** — `property.*`, `unit.*`, `page.*`, `theme.read`/`.update`, `media.*` — integrated into the existing role-based catalog without changing how roles/permissions work.

## What Foundation v0.4 adds

The Publishing & Versioning Kernel — turning every v0.3 Site Editor edit
from "live immediately" into a staged `Draft → Validation → Immutable
Revision → Publication → Public Runtime` pipeline, without touching any
prior guarantee (no RLS policy weakened, no cross-tenant test removed, no
existing migration modified):

- **`site_revisions`** — an immutable, append-only (RLS: SELECT/INSERT only, no UPDATE/DELETE — same pattern as `audit_logs`) snapshot of a Site's presentation, resolved theme tokens, and every active Page's content, numbered monotonically per Site. See [docs/PUBLISHING.md](PUBLISHING.md), [ADR 0016](adr/0016-publishing-pointer-and-snapshot-model.md).
- **`site_publications` + `sites.published_revision_id`** — a single, unambiguous pointer to "what's live now," plus an append-only publish/rollback history. Never two sources of truth.
- **`publishSite`/`rollbackSite`** (`packages/publishing`) — transactional, row-locked (serializes concurrent publishes on the same Site), tenant/site-safe by construction (a cross-tenant or cross-site revision id is structurally unpublishable, not merely rejected).
- **The public runtime (`apps/web`) reads only the published Revision** — never the live draft — via `getPublishedRevision`. A Site with no publication 404s, indistinguishable from an unresolvable hostname.
- **A gated preview** in `apps/admin` — the current draft, rendered through the exact same renderer the public site uses, behind the full existing session/Membership/permission chain (`release.read`) — no new auth mechanism, no shareable token.
- **Optimistic concurrency on draft edits** — `packages/content`/`packages/sites`' Page/Site mutation functions accept an opt-in `expectedUpdatedAt`, rejecting a stale write (`PageConflictError`/`SiteConflictError`) instead of silently overwriting a newer one. Every v0.3 call site is unaffected (the parameter is optional).
- **`release.read`/`release.publish` wired up** — declared in v0.1/v0.2's permission catalog, unused until now. No new permissions were needed.

## What Foundation v0.5 adds

The Content & Site Composition Kernel — replacing the previously-opaque
`SiteSnapshot["site"]["navigation"]: unknown` with a real, typed, publish-
time-resolved contract, and closing the gap where a Revision's media
appearance could silently drift after publish. See
[ADR 0017](adr/0017-site-composition-kernel.md).

- **Typed Draft navigation** (`packages/content`'s `navigationSchema`) — internal links reference a Page by stable `pageId`, external links reuse the existing `safeHrefSchema` allowlist. `packages/sites`' `updateSiteNavigation` validates the shape at write time.
- **Resolved navigation at publish time** — `assembleDraft` resolves every `pageId` to the Page's `slug`, in the same single pass as everything else (no extra query, no new race). A Draft slug rename after publish never changes an already-published Revision's navigation.
- **A generic block-reference mechanism** (`BlockDefinition.references`) — every block declares its own media/domain references; the composition pipeline needs no central switch over block types to know what to freeze or check.
- **Frozen media manifests** — every MediaAsset a published Page's blocks/SEO reference is resolved and frozen (as a descriptor, never the binary) into the Revision. The public runtime renders from this frozen manifest, not a live lookup; Draft preview still uses a live lookup, correctly.
- **Publish-time domain reference checks** — a `propertyId`/`unitId` a domain-bound block references must exist for the tenant, without freezing that row's own fields (Property/Unit/Amenity data stays entirely live, unchanged from v0.4).
- **An explicitly-versioned snapshot format** (`schemaVersion: 2`) with a real runtime parser (`parseSiteSnapshot`) replacing the previous `revision.snapshot as SiteSnapshot` casts, and a normalization path for pre-v0.5 (v0.4) Revisions.
- **The public runtime resolves any published Page**, not only home (`apps/web/app/[[...slug]]/page.tsx`) — a necessary consequence of resolved navigation actually going somewhere.
- **SEO wired into rendered output for the first time** — `generateMetadata` reads title/description/canonical/robots/og:image from the published Revision's own `seo` field (the existing `seoSchema` contract, validated since v0.3 but never previously read by anything).

## What Foundation v0.6 adds

The Rental Domain & Guest Experience Kernel — richer Property/Unit guest-
facing data, a real public-vs-admin Rental visibility boundary, and
Property-level Amenities, without touching v0.4/v0.5's Presentation-
Frozen/Business-Live boundary or the media-freezing/reference mechanism.
See [ADR 0018](adr/0018-rental-domain-guest-experience.md).

- **Guest Experience fields on `Property`** — check-in/out times, quiet hours (both native `time` columns), a tri-state (`allowed`/`not_allowed`/`on_request`) smoking/pets/events policy, and `locationDisclosure` (`exact`/`approximate`/`hidden`, defaulting to `exact` so no existing Property's rendered address silently changes).
- **Structured sleeping arrangements** (`unit_sleeping_arrangements`) — room label, bed type, quantity, ordering, with real create/update/delete, replacing the crude `beds` aggregate for any Unit detailed enough to have them. `beds` remains the fallback when no detail rows exist.
- **Property-level Amenities** (`property_amenities`) — the same catalog-join shape as the pre-existing `unit_amenities`, one level up, for facts that belong to the whole Property (a shared pool) rather than one Unit.
- **A real, minimal amenity metadata schema** (`amenityMetadataSchema`) — `unit_amenities`/`property_amenities.metadata` was JSONB with zero validation (and, in practice, no write path) since v0.3; now a small, closed, `.strict()` shape applied uniformly.
- **A named public-vs-admin Rental visibility boundary** — `isPublicPropertyStatus`/`isPublicUnitStatus`, public-scoped read functions, and `RenderContext.publicOnly` (the direct sibling of v0.5's `RenderContext.media`). Closes a real pre-v0.6 gap: `property-summary`/`amenities` blocks applied no status filtering at all; only `unit-grid` did, inline.
- **Location-privacy enforced server-side, not just UI-hidden** — `packages/rentals/src/guest-view.ts`'s guest-view projection structurally omits address fields a Property's `locationDisclosure` doesn't allow; a renderer that forgets to check disclosure cannot leak the address, because the private fields were never in the object it received.
- **Hardened publish-time domain-reference validation** — a `propertyId`/`unitId` a block references must now also be currently public (`domain_reference_not_active`, distinct from `domain_reference_missing`), catching a page bound to draft/archived rental data at edit time instead of only at render time.
- **Optimistic concurrency extended to Property/Unit** — the same opt-in `expectedUpdatedAt`/`*ConflictError` pattern `packages/sites`/`packages/content` already use, backward-compatible.
- **All three touched content blocks stay on `@1`** — every new prop is optional and defaulted-false; an already-stored instance keeps rendering exactly as before. `amenities@1` widens to accept `propertyId` as an alternative to `unitId` without breaking any stored instance.
- **A minimal but real admin UI** — Property/Unit edit forms now expose every field the domain model has (including several pre-existing ones — `internalName`, full address, lat/lng, timezone, `beds`/`bathrooms`/`size` — that had zero UI before v0.6), plus Property-level amenity selection and sleeping-arrangement add/remove.

## What Foundation v0.7 adds

The Virtual Tour & Immersive Experience Kernel — a first-class,
provider-agnostic `VirtualTour` domain entity (Matterport as the first
registered provider), embeddable via the existing generic block-reference
mechanism, with the Presentation-Frozen/Business-Live boundary and
composite-FK ownership guarantees v0.6 established extended to it
unchanged. See [ADR 0019](adr/0019-virtual-tour-immersive-kernel.md).

- **`virtual_tours`** — tied to a Property (always) and optionally a Unit, Postgres-enforced (a Unit belonging to a different Property is rejected at `INSERT`/`UPDATE`, not merely application-checked), same `draft`/`active`/`archived` lifecycle shape as Property/Unit.
- **A closed VirtualTour provider registry** (`packages/virtual-tours`) — every provider-specific concern (URL construction, input normalization, CSP frame origins) lives behind one shape; no `provider === "matterport"` branch anywhere else in the codebase, and no "generic iframe provider" a caller could ever register.
- **A Matterport adapter**, verified against Matterport's own current official documentation (not training-data memory) — accepts a share URL or bare Model SID, rejects everything else (wrong host, lookalike domains, non-`https` schemes including `javascript:`/`data:`/`blob:`, malformed ids).
- **`virtual-tour@1`** — a domain-bound content block reusing the exact same generic `BlockDefinition.references` mechanism v0.5 introduced; no parallel reference system.
- **Publish-time validation gains `domain_reference_invalid`** — a third failure mode alongside `domain_reference_missing`/`domain_reference_not_active`, for a VirtualTour row whose provider/asset-id no longer validates against the live registry.
- **A CSP `frame-src` policy** on both `apps/web` and `apps/admin`, restricted to exactly the registered providers' own origins (no wildcards), kept in sync with the provider registry by a dedicated test rather than by hand-auditing two files.
- **New permissions** — `tour.read`/`.create`/`.update`/`.delete`, their own namespace rather than reusing `media.*`.
- **A minimal admin CRUD surface** on the Property page — create/list/change-status/remove, with a live status `<select>` (not a form submit) demonstrating that archiving a Tour removes it from the public site immediately.
- **No Matterport SDK, API key, OAuth, GraphQL client, or webhook integration anywhere** — the entire feature is deterministic, first-party-constructed URL building from an admin-supplied identifier.

## What Foundation v0.7.1 adds

Virtual Tour Experience & Embed Hardening — a production-hardening pass
over v0.7's functional baseline, with no schema migration. See
[ADR 0020](adr/0020-virtual-tour-experience-hardening.md).

- **Click-to-load by default, public and preview alike.** No `<iframe>` mounts until a visitor clicks "Démarrer la visite virtuelle" — no hidden iframe, no preconnect, no provider script, no server-side Matterport fetch before that click.
- **An explicit state machine** (`idle`/`loading`/`loaded`/`error`), extracted into a pure, framework-agnostic reducer, unit-tested for the hard cases (a late load after timeout, a late timeout after success, independent multi-instance state) with plain `vitest` — no jsdom added.
- **A centralized, cancellable load timeout** with retry-via-remount (a fresh `attempt` forces a fresh `<iframe>` element, never a stuck one).
- **Accessibility hardening** — contextualized `title`/`aria-label` (never bare "iframe"/"Matterport"), no focus loss when the trigger button unmounts, keyboard-only operable, `aria-live` scoped to the loading state only.
- **`referrerPolicy="no-referrer"`** on the eventually-mounted iframe.
- **A real `sandbox` study**, concluding (same outcome as v0.7, now with actual reasoning) that the attribute stays absent — see the ADR for why.
- **`packages/renderer`'s and the public runtime's first `"use client"` component**, isolated to exactly the interactive click/timeout/retry surface — all tenant-scoped data resolution stays server-side.

## What Foundation v0.8 adds

The Site Theme, Branding & Design System Kernel — a second, additive
per-site brand-identity layer next to v0.3's untouched platform `Theme`
catalog, letting each Site have its own colors, typography, logo/favicon,
and button/section style, all through closed, validated tokens — never
arbitrary CSS. See [ADR 0021](adr/0021-site-theme-branding-design-system.md).

- **`SiteBranding`** (`packages/themes/src/branding.ts`) — a versioned (`{version: 1}`), `.strict()`-validated per-site model: brand name/logo/logoDark/favicon (Media references), semantic colors, a closed typography/radius/spacing/button-style/section-style token set. `DEFAULT_SITE_BRANDING` keeps every pre-v0.8 Site rendering unchanged.
- **Hex-only color validation** (`packages/validation/src/color.ts`) — an allowlist (`#RGB`/`#RRGGBB` only), rejecting `rgb()`/`hsl()`/`var()`/`url()`/named colors/`javascript:`/`data:`/`blob:`/CSS-breakout attempts by construction, not by enumeration.
- **A closed, web-safe font-stack registry** — 5 fixed `font-family` stacks; no font URL, no `@import`, no `next/font/google` build-time fetch (a deliberate, disclosed limitation — see the ADR).
- **Logo/favicon via the existing Media system** — UUID-only references, never a raw external URL; a missing/stale reference degrades gracefully at publish time (`resolveBrandMedia`) rather than blocking the publish, deliberately diverging from content-block media's stricter contract ("a logo is chrome, not content").
- **`sites.branding jsonb`** (migration 0015) — stores only the tenant's override delta, mirroring the existing `theme_overrides` column's own shape; no new table.
- **Publication snapshot v3** — `branding` is now part of every frozen Revision, resolved and validated in the same `assembleDraft` pass as pages/navigation/media/theme. Historical (pre-v0.8) Revisions still parse, normalized forward with `DEFAULT_SITE_BRANDING`.
- **`RenderContext.branding`**, resolved identically for Draft Preview and Public through one shared, pure resolution module (`packages/renderer/src/resolve-branding.ts`) — no `isPreview` branch. Emits a closed `--site-*` CSS custom-property set, server-rendered, zero client JS, zero theme flash.
- **Contrast/accessibility**: a non-blocking WCAG-ratio warning surfaced in the admin Appearance form — a tenant's chosen colors are never silently auto-corrected.
- **A minimal admin "Appearance" section** on the Site detail page — brand name, colors, typography, radius/spacing, button/section style, logo/favicon picker — reusing the existing `theme.read`/`.update` permissions, no new namespace.
- **A durable monorepo pattern**: a `@provence360/themes/branding` package-export subpath, so a client component can import pure design-token constants without pulling the database driver into the browser bundle.

## What Foundation v0.9 adds

The Media Ingestion, Asset Lifecycle & Delivery Kernel — turns `MediaAsset`
from a reference-only abstraction into a real, tenant-isolated upload,
storage, and delivery pipeline. See
[ADR 0022](adr/0022-media-ingestion-asset-delivery.md) and
[docs/MEDIA.md](MEDIA.md).

- **`packages/media`** — a new package owning upload intents, object
  storage, real file validation, variant generation, and delivery.
  `packages/content` keeps owning the `MediaAsset` entity itself.
- **Two-phase upload** — `media_uploads` (migration 0016), a short-lived,
  one-shot, RLS-scoped upload intent, distinct from `media_assets`: a
  MediaAsset is created only once real bytes have been decoded, validated,
  and processed.
- **Real file validation** — a genuine `sharp` decode, format allowlisted
  _after_ decode (`jpeg`/`png`/`webp`; SVG always rejected, AVIF excluded
  since this build's `sharp` has no AVIF codec), size/pixel-count limits,
  a SHA-256 checksum computed from the actually-stored bytes.
- **`ObjectStorage` abstraction** — `MemoryObjectStorage` (default, tests
  and local dev) and `S3ObjectStorage` (AWS S3/R2/MinIO-compatible),
  behind one narrow interface; no provider-specific type anywhere else.
- **A closed, versioned variant registry** — thumbnail/small/medium/large,
  never upscaled, never a separate table.
- **Same-origin, fingerprint-gated delivery** — `/media/{assetId}/{fingerprint}/{variant}`,
  resolved by one shared core both apps' routes call; `Cache-Control:
immutable` only when the URL is genuinely content-addressed.
- **Publication snapshot v4** — the frozen `MediaDescriptor` gains optional
  `checksumSha256`/`byteSize`/`variants`; historical v3 Revisions still
  parse, purely relabeled forward.
- **Responsive rendering** — `resolveResponsiveImage` (`packages/renderer`)
  picks a real variant and builds a real `srcSet`, with a byte-for-byte
  fallback to the pre-v0.9 behavior for any legacy asset.
- **Admin Media Library + reusable `MediaPicker`/`GalleryMediaPicker`** —
  upload, thumbnail grid, and a visual picker wired into SiteBranding
  logo/logoDark/favicon and Hero/Gallery block editing — no more
  manually-typed MediaAsset UUIDs on those surfaces.
- **Two real, previously-invisible bugs found and fixed** during this
  phase's own end-to-end testing: a transaction-rollback fail-marking bug,
  and a Next.js cross-bundle module-singleton bug (fixed via `globalThis`
  memoization) — both documented in ADR 0022 as durable, reusable
  patterns for this codebase.

## What's still explicitly out of scope

Deferred on purpose — building any of these now would mean guessing at
requirements a later phase hasn't settled yet:

- **Matterport SDK, programmatic room navigation, Mattertags, the Matterport floorplans/metrics APIs, Matterport sync/webhooks/OAuth/account management, tour generation, 360° upload, other panorama providers (Kuula/CloudPano/3DVista), WebXR, native VR, a proprietary panorama viewer, or a homemade 3D engine.** v0.7.1 hardens the existing static-embed experience only — see [ADR 0020](adr/0020-virtual-tour-experience-hardening.md).
- **Scheduled/future-dated publishing, a Revision diff view, or per-object (not per-tenant) preview links.** See [docs/PUBLISHING.md#risks--deliberately-out-of-scope](PUBLISHING.md#risks--deliberately-out-of-scope).
- **The booking engine.** No availability, pricing, or reservation flow — the entire reason this platform exists, and still entirely out of scope.
- **An AI content generator.** None — content is authored by hand through the Site Editor.
- **Airbnb/Booking.com integrations.** No channel management, no iCal sync.
- **Rich text.** Text content is plain text only (`\n`-separated paragraphs); no structured/sanitized rich-text block yet. See [docs/RENDERING.md#security](RENDERING.md#security).
- **A translator UI / per-locale routing.** See [docs/LOCALIZATION.md](LOCALIZATION.md).
- **The automatic site generator.** Provisioning a new Site (and its Properties/Units/Pages) is a manual admin/seed-script action, not a guided or automated flow.
- **A platform super-admin.** No way to act across every tenant through the web application — see [ADR 0009](adr/0009-platform-admin-vs-tenant-owner.md).
- **A drag-and-drop theme builder, custom CSS/JS, a theme marketplace, many pre-built templates, complex animations, a responsive layout editor, or AI-generated/Figma-imported theming.** v0.8 ships a closed, validated token kernel only — see [ADR 0021](adr/0021-site-theme-branding-design-system.md).
- **Video transcoding, adaptive streaming, PDF processing, remote-URL image import, AI image tagging/object recognition, photo retouching, a crop editor, a full proprietary CDN, or an enterprise DAM.** v0.9 is an image-first ingestion/delivery kernel only — see [ADR 0022](adr/0022-media-ingestion-asset-delivery.md).

## Known gaps left for the next phase

- **No self-service signup, password reset, or email verification.** A user is provisioned by an existing OWNER/ADMIN or the seed script. See [docs/AUTHENTICATION.md](AUTHENTICATION.md).
- **Login rate limiting is per-email, not per-IP.** No trusted client-IP plumbing exists yet — documented explicitly as a gap in [docs/AUTHENTICATION.md#rate-limiting](AUTHENTICATION.md#rate-limiting) rather than papered over with an untrustworthy header.
- **Fine-grained, per-resource permissions.** The permission catalog (`packages/auth/src/permissions.ts`) is role-based, not per-object (e.g. no "can edit this one Page but not that one" within a tenant) — true for v0.1's resources and still true for v0.3's.
- **No scheduled publishing or Revision diff view.** `Draft`/`Releases` (v0.4's Publishing & Versioning Kernel) exist now — see [docs/PUBLISHING.md](PUBLISHING.md) — but `publishSite` always publishes immediately, and there's no UI to diff two Revisions' content against each other yet.
- **Real observability.** `packages/observability`'s logger is structured JSON-lines to stdout; no OTel export, no tracing, no metrics backend, no request-id correlation across service boundaries yet.
- **Worker jobs.** `apps/worker` is a heartbeat-only process boundary — domain re-verification, release publishing, session cleanup, and any other scheduled work land here once there's something to schedule.
- **A platform super-admin.** Deliberately undesigned so far — see [ADR 0009](adr/0009-platform-admin-vs-tenant-owner.md) for why it needs its own identity concept rather than an extension of `MembershipRole`.
- **No MediaAsset deletion UI or safe garbage collection.** `deleteMediaAsset` exists but is not exposed anywhere in v0.9's Admin Media Library — reference-counting across every Draft and historical Revision before allowing a delete is deferred to a future phase. See [ADR 0022](adr/0022-media-ingestion-asset-delivery.md), Decision 14.
- **`S3ObjectStorage` has no live-bucket integration test.** This sandboxed development environment has no Docker/MinIO available; the adapter is exercised via TypeScript's structural typing against `ObjectStorage` only. Smoke-test manually against a real bucket before relying on it in production. See [docs/MEDIA.md](MEDIA.md).
- **No structured admin form for SEO's `ogImageMediaId` or VirtualTour's `posterMediaId`.** Both remain editable only through the generic block-props JSON textarea — the v0.9 `MediaPicker` was wired into Hero/Gallery/SiteBranding only, per ADR 0022, Decision 13.
- **No component/block-level theme variants.** Only the token layer ships in v0.3 — see [docs/THEMES.md](THEMES.md).
- **No admin UI for editing navigation by hand.** v0.5 ships the typed contract, publish-time resolution, and DB write path (`updateSiteNavigation`) — demonstrated end-to-end via the dev seed (Villas Cassis' Home/Contact nav) and tests, not a form in `apps/admin` yet. See [ADR 0017](adr/0017-site-composition-kernel.md).
- **No per-unit sleeping-arrangement bulk-import or reordering drag-and-drop.** v0.6 ships real create/update/delete plus a stable `ordering` column, but the admin UI only exposes add + delete (an owner reorders by deleting and re-adding, or a future PATCH-based reorder UI); update on an existing row is exercised at the repository/API level, not yet wired into a form.
- **VirtualTour provider count: one (Matterport).** The registry is designed for a second provider to be a pure addition (one new `VirtualTourProviderDefinition` + one `register()` call, no other call site changes) — but only Matterport is registered today, matching the brief's own scope.
- **No real branded webfonts.** `SiteBranding.typography` is a closed, 5-value, web-safe system-font registry — no `next/font/local`/custom font-file upload yet (deliberately deferred rather than risking an unverified build-time network fetch to Google Fonts in this environment). See [ADR 0021](adr/0021-site-theme-branding-design-system.md).
- **`cta`/`hero`'s button _color_ still comes from the v0.3 `ThemeTokens` system, not `SiteBranding`.** Only those two blocks' button _shape_ (solid/outline/ghost) is `SiteBranding`-driven — a deliberate backward-compatibility boundary, not an oversight. Every future branding-driven component is free of this constraint. See [ADR 0021](adr/0021-site-theme-branding-design-system.md#decision-10--a-deliberate-documented-boundary-between-the-two-layers-on-existing-blocks).
