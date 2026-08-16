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

## What's still explicitly out of scope

Deferred on purpose — building any of these now would mean guessing at
requirements a later phase hasn't settled yet:

- **Draft/Release/Publish.** Every Site Editor edit is live immediately — there is no staging, review, or rollback step. The data model is already designed so adding this is additive (see [docs/SITE_DOMAIN.md#future-release-compatibility](SITE_DOMAIN.md#future-release-compatibility)), but the pipeline itself doesn't exist yet.
- **The booking engine.** No availability, pricing, or reservation flow — the entire reason this platform exists, and still entirely out of scope.
- **An AI content generator.** None — content is authored by hand through the Site Editor.
- **Airbnb/Booking.com integrations.** No channel management, no iCal sync.
- **A real media upload/CDN pipeline.** `MediaAsset` is a stable reference; there's no upload flow, image transform, or CDN behind it. See [ADR 0012](adr/0012-media-asset-and-amenity-catalog.md).
- **Rich text.** Text content is plain text only (`\n`-separated paragraphs); no structured/sanitized rich-text block yet. See [docs/RENDERING.md#security](RENDERING.md#security).
- **A translator UI / per-locale routing.** See [docs/LOCALIZATION.md](LOCALIZATION.md).
- **The automatic site generator.** Provisioning a new Site (and its Properties/Units/Pages) is a manual admin/seed-script action, not a guided or automated flow.
- **A platform super-admin.** No way to act across every tenant through the web application — see [ADR 0009](adr/0009-platform-admin-vs-tenant-owner.md).

## Known gaps left for the next phase

- **No self-service signup, password reset, or email verification.** A user is provisioned by an existing OWNER/ADMIN or the seed script. See [docs/AUTHENTICATION.md](AUTHENTICATION.md).
- **Login rate limiting is per-email, not per-IP.** No trusted client-IP plumbing exists yet — documented explicitly as a gap in [docs/AUTHENTICATION.md#rate-limiting](AUTHENTICATION.md#rate-limiting) rather than papered over with an untrustworthy header.
- **Fine-grained, per-resource permissions.** The permission catalog (`packages/auth/src/permissions.ts`) is role-based, not per-object (e.g. no "can edit this one Page but not that one" within a tenant) — true for v0.1's resources and still true for v0.3's.
- **`Draft`/`Releases`.** Sites have no publish workflow — what's in `pages.content` (and the rest of the Site Domain) is what's live. The request pipeline's future `PublishedRelease` step (see `docs/ARCHITECTURE.md`) is a no-op today; the current pipeline reads live rows directly.
- **Real observability.** `packages/observability`'s logger is structured JSON-lines to stdout; no OTel export, no tracing, no metrics backend, no request-id correlation across service boundaries yet.
- **Worker jobs.** `apps/worker` is a heartbeat-only process boundary — domain re-verification, release publishing, session cleanup, and any other scheduled work land here once there's something to schedule.
- **A platform super-admin.** Deliberately undesigned so far — see [ADR 0009](adr/0009-platform-admin-vs-tenant-owner.md) for why it needs its own identity concept rather than an extension of `MembershipRole`.
- **No per-amenity metadata schema.** `unit_amenities.metadata` exists as a small JSONB escape hatch (e.g. `{ heated: true }` for a pool) but nothing validates or defines its shape per catalog entry yet — deliberately deferred until there's a second real consumer. See [ADR 0012](adr/0012-media-asset-and-amenity-catalog.md).
- **No component/block-level theme variants.** Only the token layer ships in v0.3 — see [docs/THEMES.md](THEMES.md).
