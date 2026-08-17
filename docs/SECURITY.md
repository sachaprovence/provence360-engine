# Security

## Threat model for this phase

The property this Foundation exists to guarantee: **Tenant A can never
read, modify, or delete Tenant B's data — even if Tenant A's code has a
bug, even if it knows Tenant B's UUIDs outright.** Everything below is in
service of that one sentence.

Foundation v0.2 adds a second property on top: **a request is never
granted tenant access because of what a URL says — only because of what a
verified session's Membership says.** The chain is always
`User -> Authenticated Session -> Membership -> Authorization -> Tenant
Context -> PostgreSQL RLS -> Data`, never `User -> browser-supplied
tenantId -> Data`. See [docs/AUTHENTICATION.md](AUTHENTICATION.md) and
[docs/AUTHORIZATION.md](AUTHORIZATION.md) for the full mechanics; this
document stays focused on the database-level enforcement both properties
ultimately rest on.

Foundation v0.1 proved the first property at the data-access layer alone,
exercised directly by tests rather than through an authenticated HTTP
request — there was no login flow yet. v0.2 keeps every one of those
guarantees (nothing about RLS, `withTenantContext`, or the resolver
changed) and adds real authentication/authorization on top, proven the
same way: real Postgres, real HTTP requests, real Playwright sessions, no
mocked auth.

## Defense in depth

Five independent layers, each capable of stopping a cross-tenant read on
its own:

1. **Application context** (`packages/tenant/src/context.ts`) — an
   `AsyncLocalStorage`-backed `getCurrentTenantId()`. Convenience and a
   guard rail (assertions, audit logging), not the enforcement mechanism —
   nothing stops a bug from calling the database without ever consulting
   it.
2. **Repository/service tenant-awareness** — every repository function in
   `packages/sites`, `packages/domains`, `packages/rentals`/`packages/content`
   (v0.3), and (new in v0.4) `packages/publishing` filters explicitly by
   `tenant_id`, derived via `requireCurrentTenantId()`, and _never_ accepts
   a `tenantId` argument from its caller. A repository function cannot be
   tricked into using the wrong tenant by a caller passing the wrong value,
   because there is no such parameter to pass.
3. **PostgreSQL Row-Level Security** — the actual, unconditional backstop.
   Enforced by Postgres itself on every query issued through the app role,
   independent of whether layers 1–2 were even reached. See below.
4. **Composite foreign keys** — every child table with a real parent
   (`properties`, `units`, `unit_amenities`, `pages` in v0.3;
   `site_revisions`, `site_publications` in v0.4;
   `unit_sleeping_arrangements`, `property_amenities` in v0.6) carries a
   foreign key on
   `(tenant_id, parent_id)` against its parent's own `UNIQUE (tenant_id,
id)` index, not just a plain `parent_id` FK. A row whose `tenant_id`
   doesn't match its parent's owner is rejected by Postgres at
   `INSERT`/`UPDATE` time (`23503`) — before RLS's `WITH CHECK` is even
   evaluated. `sites.published_revision_id → site_revisions` is the one
   case that couldn't be declared as a normal `foreignKey()` in
   `schema.ts` (a Drizzle DSL forward-reference limitation, not a
   PostgreSQL one — `site_revisions` is declared later in the file than
   `sites`) — it's instead a hand-written composite FK in migration 0010,
   `FOREIGN KEY (tenant_id, id, published_revision_id) REFERENCES
site_revisions (tenant_id, site_id, id) ON DELETE RESTRICT`, backed by
   a new `UNIQUE (tenant_id, site_id, id)` on `site_revisions` (migration
   0009). Same guarantee, same enforcement point (Postgres, `23503`,
   every role including the admin connection) — just expressed as raw SQL
   instead of the schema DSL. See
   [ADR 0016](adr/0016-publishing-pointer-and-snapshot-model.md) for the
   full reasoning and
   `packages/publishing/src/db-constraints.test.ts` for the tests. See
   also
   [docs/SITE_DOMAIN.md#ownership-consistency-db-constraints-not-only-rls](SITE_DOMAIN.md#ownership-consistency-db-constraints-not-only-rls)
   and [ADR 0010](adr/0010-property-unit-ownership.md).
5. **Explicit tests** — `packages/tenant`, `packages/domains`,
   `packages/sites`, `packages/observability`, `packages/rentals`,
   `packages/content`, `packages/renderer` (v0.3), and `packages/publishing`
   (v0.4) each carry tests that create two real tenants in a real Postgres
   database and assert one cannot read, update, delete, or attach to the
   other's rows — including via a forged foreign key, bypassing the
   repository helper entirely. See
   [Testing](#how-the-tests-actually-exercise-rls) below.

Layers 1 and 2 are conventions enforced by code review and TypeScript's
type system where possible (e.g. repository functions have no `tenantId`
parameter to misuse) — they are not hard technical barriers. Layers 3 and
4 are. If layers 1–2 vanished entirely tomorrow, layer 3 alone would still
hold the boundary — the "RLS rejects an insert whose tenant_id doesn't
match the active context, even bypassing the repository helper" test in
`packages/sites/src/site-repository.test.ts` (and its v0.3 counterparts in
`packages/rentals`/`packages/content`) exists specifically to prove that.

## The four roles

Four distinct Postgres roles, four distinct connection strings
(`DATABASE_URL`, `DATABASE_URL_APP`, `DATABASE_URL_RESOLVER`,
`DATABASE_URL_AUTH` — see `.env.example`). Collapsing them into one
connection would silently collapse the security model.

| Role                   | Used by                                                                                        | Privileges                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provence360` (admin)  | migrations, dev seed, `packages/testkit` fixtures                                              | Table owner — Postgres never applies RLS to an owner. Full, unconditional access. **Never used to serve a tenant-facing request.**                                                                                                                                                                                                                                                           |
| `provence360_app`      | every tenant-scoped repository, always via `withTenantContext()`                               | Full DML on all tables it's granted, but every query is filtered by the RLS policies below. Cannot see or touch a row outside the active `app.tenant_id`. **No grant on `sessions` at all**, and on `users` only `SELECT (id, email, name, created_at, updated_at)` — `password_hash` is unreachable through this role, full stop.                                                           |
| `provence360_resolver` | `packages/domains/src/resolver.ts` only                                                        | `SELECT`-only, and only on specific _columns_ of `sites` and `domains` (`id`, `tenant_id`, `status`, `hostname`, `site_id`, `is_primary` — never `name`, never anything content-shaped). Granted a permissive `USING (true)` RLS policy because its whole job is cross-tenant hostname lookup, which by definition runs before a tenant is known.                                            |
| `provence360_auth`     | `packages/auth` only — session validation, login, membership/tenant lookups pre-tenant-context | `SELECT`/`INSERT`/`UPDATE`/`DELETE` on `sessions` (the only role that touches it); `SELECT` plus `UPDATE (password_hash, updated_at)` on `users`; `SELECT`-only on `memberships`/`tenants`; `SELECT`/`INSERT` on `audit_logs`, restricted by RLS to `tenant_id IS NULL` rows only. **No grant on `sites` or `domains` at all.** See [ADR 0008](adr/0008-domain-resolver-grant-hardening.md). |

`packages/database/src/scripts/setup-roles.ts` (via `pnpm db:setup-roles`)
creates/updates all four roles idempotently, deriving username _and_
password from each `DATABASE_URL_*` so the role Postgres actually has can
never drift from the connection string the app uses to reach it. Every
table- and column-level `GRANT` (as opposed to the role itself and its
`CONNECT`/`USAGE` privileges) lives in a versioned migration
(`packages/database/migrations/0003_auth_role_grants.sql`), not in that
script — see [ADR 0008](adr/0008-domain-resolver-grant-hardening.md) for
why that distinction matters.

The resolver and auth roles' grants are fully disjoint by design: the
resolver can never see a password hash or a session; the auth role can
never see a site's or domain's content. Proven directly (not just assumed)
by `packages/auth/src/role-boundaries.test.ts`.

## How `withTenantContext` actually enforces the boundary

```ts
await withTenantContext(tenantId, async (tx) => {
  // every query on `tx` is now RLS-scoped to `tenantId`
});
```

Internally: one Postgres transaction, `select set_config('app.tenant_id', $1, true)`
run first (the parameterized equivalent of `SET LOCAL` — no string
interpolation of the tenant id into SQL), then the caller's callback runs
against that transaction. `set_config(..., true)` is scoped to the
transaction and is reset automatically on `COMMIT`/`ROLLBACK` — there is
nothing to leak onto the next request that happens to reuse the same
pooled connection, and nothing to remember to clean up.

A request that never calls `withTenantContext()` has no tenant-scoped
database access at all: `current_setting('app.tenant_id', true)` returns
`NULL` when unset, `tenant_id = NULL` is never true, and RLS denies every
row. This is exercised directly by the "fails closed" test in
`packages/tenant/src/with-tenant-context.test.ts`.

## RLS policies, table by table

Defined in `packages/database/src/schema.ts`, next to each table:

- **`tenants`** — `id = current_setting('app.tenant_id', true)::uuid`. A tenant can only ever see its own row.
- **`memberships`, `sites`, `domains`** — `tenant_id = current_setting('app.tenant_id', true)::uuid`, for all four commands (`SELECT`/`INSERT`/`UPDATE`/`DELETE`), as both the `USING` (which rows are visible) and `WITH CHECK` (which rows may be written) clause. A write that tries to set the wrong `tenant_id` is rejected by `WITH CHECK`, not just hidden from later reads.
- **`users`** — no `tenant_id` column (see [MULTI_TENANCY.md](MULTI_TENANCY.md) for why). Visibility for the app role is `EXISTS (SELECT 1 FROM memberships WHERE user_id = users.id AND tenant_id = current tenant)` — a user is visible only to a tenant it actually has a membership in. A separate, additive policy (`auth_lookup_users`) permits `provence360_auth` to `SELECT` any row (login has to find a user by email before any tenant is known) and `UPDATE` only `password_hash`/`updated_at` (`auth_update_users`) — column grants, not RLS, are what stop that role from touching anything else on the row.
- **`audit_logs`** — `SELECT` and `INSERT` policies exist for the app role, scoped to the active tenant; **no `UPDATE`/`DELETE` policy does**. With RLS enabled, an operation with no matching permissive policy is denied outright, regardless of `tenant_id`. The audit trail is append-only at the database level, not by application convention — see the immutability tests in `packages/observability/src/audit-log.test.ts`. A second pair of policies (`auth_insert_audit_logs`/`auth_read_audit_logs`) permits `provence360_auth` to insert/read only rows where `tenant_id IS NULL` — the identity-plane events (`AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILURE`, `AUTH_LOGOUT`) that happen before any tenant is selected. This role is structurally incapable of forging a tenant-scoped audit entry, or of reading one — proven in both directions by `packages/auth/src/audit.test.ts`.
- **`sessions`** — one policy, `auth_manage_sessions`, `FOR ALL` to `provence360_auth` only. `provence360_app` has no grant on this table whatsoever (not even a denying RLS policy is needed — there's nothing to authorize in the first place). See [ADR 0007](adr/0007-session-strategy.md).
- **`sites`, `domains`** additionally carry a second, `SELECT`-only, `USING (true)` policy granted to `provence360_resolver` — see [the four roles](#the-four-roles).
- **`memberships`, `tenants`** additionally carry a `SELECT`-only policy granted to `provence360_auth` (`auth_read_memberships`/`auth_read_tenants`) — the read side of `getMembership()`/`listMembershipsForUser()`, which have to run before `withTenantContext` can open. Membership _mutations_ never go through this role; they go through `packages/auth/src/membership-repository.ts`, tenant-scoped and permission-checked, exactly like `sites`/`domains`.
- **`properties`, `units`, `unit_amenities`, `media_assets`, `pages`** (v0.3), **`unit_sleeping_arrangements`, `property_amenities`** (v0.6) — `tenant_id = current_setting('app.tenant_id', true)::uuid`, same `FOR ALL`/`USING`+`WITH CHECK` shape as `sites`/`domains`, each additionally backstopped by the composite-FK layer described above. See `packages/rentals/src/rls.test.ts` for the v0.6 tables' direct, real-Postgres cross-tenant tests.
- **`themes`, `amenities`** (v0.3) — platform-level catalogs, not tenant-scoped at all. Both carry a permissive `SELECT`-only, `USING (true)` policy granted to `provence360_app` (every tenant reads the same rows) and **no write grant whatsoever** for that role — writes are reserved for the table-owning admin role, exactly the `sites`/`domains` resolver-role pattern applied to writes instead of reads. See [ADR 0011](adr/0011-theme-token-model.md) and [ADR 0012](adr/0012-media-asset-and-amenity-catalog.md).

## v0.3 adversarial review

Section 48 of the v0.3 brief calls for attacking the system directly
(cross-tenant Media/Page/Property/Unit references, invalid block JSON,
unknown block versions, type spoofing, dangerous URLs, XSS, slug
path-traversal, forged admin mutations, insufficient permission, tenant
leak via the renderer) and requires any real finding to be both fixed and
given a regression test. Two real issues were found and fixed during this
phase:

1. **Protocol-relative URL bypass in `safeHrefSchema`.** The initial
   implementation of the href allowlist (`packages/validation/src/safe-url.ts`,
   used by every block with a link — `hero.ctaHref`, `cta.buttonHref`)
   accepted any string starting with `/`, including `//evil.com` — which a
   browser resolves as a full absolute URL against the current page's own
   scheme, exactly the same redirect risk as accepting `https://evil.com`
   outright. **Fixed** by explicitly excluding a `//`-prefixed value from
   the "safe relative path" case. **Regression test:** `safe-url.test.ts`'s
   `"rejects //evil.com"` case, caught by the test suite itself before
   this ever reached the seed data or a real block.
2. **No adversarial test proving slug normalization is path-traversal-safe.**
   `normalizeSlug` was already safe by construction (every character
   outside `[a-z0-9]` — including `/` and `.` — collapses to a single
   hyphen, so `..`/`/` cannot survive normalization), but nothing proved
   it. **Fixed** by adding an explicit regression test
   (`slug.test.ts`: `../../etc/passwd` → `etc-passwd`, `..%2F..%2Fetc` →
   `2f-2fetc`, `....//....//` → `""`) rather than leaving it as an
   undiscovered, unverified assumption.

Everything else on the section 48 checklist was verified as already
correctly handled by the layers described above (cross-tenant
Property/Unit/Page/Media: RLS + composite FK + repository-layer tests in
`packages/rentals`/`packages/content`; unknown block type/version and
invalid props: the Block Registry, see
[docs/BLOCK_SYSTEM.md](BLOCK_SYSTEM.md); type spoofing: `type`/`version`
are read independently of `props`, never inferred from it; XSS: no
`dangerouslySetInnerHTML` anywhere in `packages/renderer`; tenant leak via
the renderer: the adversarial test in `render-page.test.tsx` proving a
Tenant A block referencing Tenant B's real Property renders a generic
placeholder, never Tenant B's data; forged admin mutations and
insufficient permission: every new Site Editor Server Action goes through
`withTenantPage()`, proven end to end by `apps/admin/e2e/site-editor.spec.ts`).

## How the tests actually exercise RLS

`packages/testkit` points every test at a real Postgres database
(`DATABASE_URL*` with `NODE_ENV=test`, i.e. `provence360_test` locally, a
dedicated service container in CI — see `.github/workflows/ci.yml`). Test
fixtures are written through the _admin_ connection (deliberately
RLS-bypassing — arranging a cross-tenant scenario requires being able to
create both tenants' data), and every assertion about isolation reads or
writes through `withTenantContext()`, i.e. through `provence360_app`,
subject to the exact same RLS policies production code runs under. Nothing
here is mocked — a broken policy fails a real query against a real
database, not an assertion against an in-memory stand-in.

The same discipline extends to authentication/authorization:
`packages/auth`'s test suite (session lifecycle, permission matrix, login
including the rate limiter, the owner invariant under real concurrency,
role-boundary regression tests) exercises real sessions and real
Postgres, never a mocked `validateSessionToken`. `apps/admin/e2e/` drives a
real browser against a real running Next.js server and a real database —
unauthenticated redirects, invalid/valid login, cross-tenant URL
tampering, permission-gated UI, tenant switching, and logout invalidation
are all proven end to end, not asserted against a stubbed auth layer. See
[docs/AUTHENTICATION.md](AUTHENTICATION.md) and
[docs/AUTHORIZATION.md](AUTHORIZATION.md).

## VirtualTour embeds (v0.7)

An `<iframe>` embed is, by construction, a window onto third-party
content — this feature's entire design answers "how do we let an owner
embed a real 360° tour without this becoming an arbitrary-content-
injection primitive?" See [ADR 0019](adr/0019-virtual-tour-immersive-kernel.md)
for the full reasoning; the security-relevant guarantees, specifically:

- **A closed provider registry, never a generic iframe provider.**
  `@provence360/virtual-tours`' `VirtualTourProviderDefinition` registry
  has no "generic"/pass-through provider and no way to register one whose
  `buildEmbedUrl` echoes a caller-supplied URL unchanged — every
  registered provider is first-party code fully controlling what `src` a
  VirtualTour can ever resolve to.
- **Admin input is normalized before it ever reaches the database.**
  `matterportProvider.normalize()` is a closed allowlist: exact host
  (`my.matterport.com`), `https` only (rejecting `javascript:`/`data:`/
  `blob:`/`http:` and lookalike-subdomain tricks), a valid-shaped 11-
  character Model SID. The stored `providerAssetId` is always this
  normalized value, never a raw pasted string.
- **The rendered `src` is deterministic and first-party-constructed.**
  `buildSafeVirtualTourEmbed` builds it fresh from the stored, normalized
  id — the renderer (`packages/renderer`'s `virtual-tour.tsx`) never
  touches `provider`/`providerAssetId` directly and contains no
  provider-specific branch. No `dangerouslySetInnerHTML`, no stored HTML/
  iframe string, anywhere in this feature.
- **A CSP `frame-src` allowlist on both `apps/web` and `apps/admin`**,
  restricted to exactly the registered providers' own origins — no
  wildcards — set via each app's `next.config.mjs` `headers()`. This is
  the actual enforced boundary against a hypothetical future bug in
  `buildEmbedUrl`: even if application code somehow constructed a
  non-Matterport `src`, the browser itself refuses to load it in a frame.
  Kept in sync with the live provider registry by a dedicated test
  (`packages/virtual-tours/src/csp-frame-origins.test.ts`), not by
  hand-auditing two config files.
- **No Matterport SDK, API key, OAuth flow, GraphQL client, or webhook
  integration anywhere in this codebase.** The feature is a static,
  deterministic URL construction from an admin-supplied identifier — no
  server-side fetch to Matterport to "validate" a tour, no runtime
  dependency on Matterport beyond the public embed URL itself.
- **Click-to-load (v0.7.1): zero requests to the provider's origin
  before a visitor's explicit click.** The public/preview surfaces render
  a cover/CTA state with no `<iframe>` element in the DOM at all — no
  hidden iframe, no preload, no provider preconnect, no server-side fetch
  to Matterport. `referrerPolicy="no-referrer"` on the eventually-mounted
  iframe additionally withholds the tenant site's own URL from Matterport.
  See [ADR 0020](adr/0020-virtual-tour-experience-hardening.md#decision-9--privacy-zero-requests-to-the-providers-origin-before-a-click).

## Site branding (v0.8)

A per-site brand identity (colors, fonts, logo/favicon, button/section
style) is inherently a "let the tenant put arbitrary strings into the
rendered page" feature — the whole design exists to make that safe. See
[ADR 0021](adr/0021-site-theme-branding-design-system.md) for full
reasoning; the security-relevant guarantees:

- **Colors are hex-only, allowlisted.** `packages/validation/src/color.ts`'s
  `hexColorSchema` accepts only `#RGB`/`#RRGGBB`; every non-hex form —
  `rgb()`/`hsl()`, named colors, `var(...)`, `url(...)`,
  `expression(...)`, `javascript:`, `data:`, `blob:`, and `</style>`-style
  breakout attempts — is rejected at the schema boundary before it can
  ever be stored, let alone rendered. Verified with the brief's exact
  payload list in `color.test.ts` and `branding.test.ts`.
- **Typography is a closed, web-safe stack registry — never a font URL.**
  `FontToken` is a fixed 5-value enum; there is no field anywhere a font
  URL, `@import`, or arbitrary `font-family` string could occupy.
- **Logo/favicon are UUID references into the existing Media system,
  never a raw external URL.** Same tenant-scoped `MediaAsset` catalog
  Hero/Gallery already use — no second, parallel asset pipeline, no field
  that could hold an attacker-supplied image URL.
- **No `dangerouslySetInnerHTML` anywhere in the branding pipeline**
  (grep-verified across `packages/renderer`, `packages/themes`, both
  apps). Every resolved value — including the closed `--site-*` CSS
  custom-property set `createBrandingCssVariables` emits — flows through
  a plain React `style={{ ... }}` object, never a `<style>` tag or raw
  HTML string.
- **Variable names are fixed in code; only values come from the tenant,
  and only after passing the closed schema above.** A tenant can never
  introduce a new CSS custom-property name, only a validated value for
  one of the fixed set already defined in `resolve-branding.ts`.
- **Contrast is a non-blocking warning, never a silent rewrite.** A
  tenant's chosen colors are never auto-corrected — see ADR 0021,
  Decision 11.

## Media ingestion & delivery (v0.9)

Turning `MediaAsset` from a reference-only abstraction into a real upload
pipeline is inherently a "let a tenant put an untrusted binary file into
shared object storage, then serve it back to any visitor" feature. See
[ADR 0022](adr/0022-media-ingestion-asset-delivery.md) for full reasoning;
the security-relevant guarantees:

- **Never trust extension, filename, or client-declared MIME type.**
  `finalizeMediaUpload` inspects the _actually stored_ bytes with a real
  decoder (`sharp`) and derives `mimeType`/`width`/`height` from that
  decode, never from `declaredMimeType` — proven with an explicit test that
  declares one MIME type while uploading bytes of a different real format
  (and one that declares a valid image MIME type for genuinely non-image
  bytes, still rejected).
- **Format allowlisting happens after decode, not instead of it.** This
  build's `sharp` can decode SVG via librsvg; SVG is still rejected
  (`ACCEPTED_IMAGE_FORMATS` is a closed `["jpeg", "png", "webp"]`) because
  the check is against the decoded format, never "did it decode."
- **Object keys are opaque and server-generated — a client can never
  choose, influence, or predict a storage path**, including via a hostile
  `originalFilename` (`../../../../etc/passwd`, embedded `<script>` tags,
  a literal NUL byte) — verified directly in
  `packages/media/src/security-payloads.test.ts`. `originalFilename` is
  stored purely as inert display text.
- **A MediaAsset is created only after every validation step succeeds** —
  the two-phase upload (intent → bytes → finalize) means a malicious or
  corrupt upload never produces a usable row, only a `media_uploads` entry
  marked `failed`.
- **One upload intent can never produce two MediaAssets.** A row lock
  (`SELECT ... FOR UPDATE`, the same pattern `publishSite` uses) serializes
  concurrent finalize attempts on the same intent; a `CHECK` constraint
  additionally makes a half-finalized state unrepresentable at the
  database level.
- **Multi-tenant isolation is proven at the RLS layer directly**, not just
  through the API: `packages/media/src/rls.test.ts` includes a raw-SQL-
  style cross-tenant UPDATE attempt (forging a finalize on another
  tenant's intent) and confirms the target row is genuinely untouched, plus
  cross-tenant read/insert/CHECK-constraint tests.
- **The delivery route validates every URL segment (UUID, 64-char hex
  fingerprint, closed variant enum) before any database query** — a
  malformed request 404s without ever reaching RLS or storage.
- **The delivery fingerprint gates every variant, including "original,"
  against the asset's own live `checksumSha256`.** A stale or forged
  fingerprint never resolves to bytes, for any variant — this is what
  makes `Cache-Control: immutable` an honest promise (a genuinely
  content-addressed URL) rather than a hope.
- **No remote-URL import, anywhere.** v0.9 introduces no "import image
  from URL" feature and no server-side fetch of a request-supplied URL —
  the SSRF surface that would create is explicitly out of scope, deferred
  to a future mission with its own threat model.
- **`X-Content-Type-Options: nosniff` on every delivery response**;
  `Content-Type` always comes from the database's own server-validated
  column, never reflected from a client header.
- **No storage credential ever reaches the browser.** Upload is
  server-mediated (the Admin Server Action receives bytes and calls
  `storage.putObject()` server-side) rather than presigned-URL-based — a
  deliberate divergence from the brief's own conditional suggestion,
  chosen partly because it needs no CSP `connect-src` relaxation to any
  external storage origin (see ADR 0022, Decision 11).
- **Deletion stays conservative.** The pre-existing hard-delete function is
  not exposed anywhere in the new Admin UI — see ADR 0022, Decision 14, for
  why the new delivery route's live lookup makes it newly risky to expose
  without reference-counting first.

## Known gaps (tracked, not hidden)

- **No password-reset / email-verification flow.** A user is provisioned by an existing tenant OWNER/ADMIN or the seed script; there is no self-service "forgot password." See [docs/AUTHENTICATION.md](AUTHENTICATION.md).
- **Login rate limiting is per-email, not per-IP.** No trusted client-IP plumbing exists — see [docs/AUTHENTICATION.md#rate-limiting](AUTHENTICATION.md#rate-limiting) for why that's a deliberate, stated gap rather than a naively-trusted header.
- **No platform super-admin.** There is no way to act across every tenant through the web application — only direct database/infrastructure access. See [ADR 0009](adr/0009-platform-admin-vs-tenant-owner.md).
- `docker-compose.yml` uses fixed dev passwords for every role. Fine for local dev; a real deployment must use secrets management for every `DATABASE_URL*`.
- No WAF, no secrets scanning in CI beyond "don't commit `.env`" — out of scope for this phase.
- No CSRF token beyond Server Actions' built-in same-origin check + `SameSite=Lax` — see [docs/AUTHENTICATION.md#csrf](AUTHENTICATION.md#csrf). Any future non-Server-Action mutating endpoint needs its own explicit protection.
- **No Draft/Release/Publish pipeline (v0.3).** Every Site Editor edit (a Page's metadata, a block's props, a Property/Unit field, a theme override) is live for every visitor immediately — there is no review, staging, or rollback step. See [docs/ROADMAP.md](ROADMAP.md) and [docs/SITE_DOMAIN.md#future-release-compatibility](SITE_DOMAIN.md#future-release-compatibility) for what's already designed to make adding one non-breaking.
- **Plain text only for block copy (v0.3).** No rich-text/markup block exists yet — `text@1`'s `body` renders as escaped JSX text with `\n`-separated paragraphs, nothing else. A future rich-text block must be a structured, sanitized document model, never raw HTML passed through unchanged — see [docs/RENDERING.md#security](RENDERING.md#security).
- **No real media upload/CDN pipeline (v0.3).** `media_assets.storageKey` is an opaque reference; there is no upload flow, image transform, or CDN integration behind it yet — see [ADR 0012](adr/0012-media-asset-and-amenity-catalog.md).
- **No `sandbox` attribute on the VirtualTour `<iframe>` (v0.7, restudied v0.7.1).** Matterport's own official embed snippet specifies none. v0.7.1 did a real technical study (not a repeat of "we can't test this") and confirmed `allow-scripts allow-same-origin`'s usual risk doesn't apply here (different origin from the parent page) but could not verify a minimal _sufficient_ policy without live access to Matterport's Showcase JavaScript — so the attribute stays absent rather than risk silently breaking a production tour. The CSP `frame-src` allowlist above, plus the closed provider registry and server-constructed `src`, are the real, verified compensating boundary. See [ADR 0020](adr/0020-virtual-tour-experience-hardening.md#decision-10--sandbox-studied-not-guessed-decision-unchanged-from-v07).
