# ADR 0021: Site Theme, Branding & Design System Kernel

## Status

Accepted.

## Context

ADR 0011 (v0.3) already gave every Site a closed, semantic `Theme` — a
platform-curated catalog (`themes.tokens`) a Site picks and narrowly
overrides (`sites.theme_overrides`). It works, it's tested, and the v0.8
brief's own domain-model sketch (colors, typography, radius, spacing,
buttons, sections) overlaps it substantially. The brief also repeats,
almost verbatim, the same non-negotiable v0.3 already enforces: no
`customCss`, no arbitrary CSS, a closed token set, Draft ≠ Published,
Preview and Public share one renderer.

Two paths were available: extend `packages/themes`' existing `Theme`
concept to also carry brand/logo/font/button/section data, or add a second,
additive layer next to it. The audit that opened this phase found the
existing `Theme` deliberately scoped as a **platform-level, cross-tenant
catalog** — a tenant picks and narrowly overrides a shared theme, it does
not author one from scratch (ADR 0011, decision 2). The v0.8 brief's
domain model is the opposite shape: **per-site, tenant-authored** brand
identity (a Site's own name/logo/colors, not a shared catalog entry).
Bolting that onto `themes.tokens` would either weaken the platform-catalog
invariant ADR 0011 relies on, or require a parallel "is this key
per-tenant or platform-level" branch inside the same schema. Neither is
clean.

**Decision: `SiteBranding` is a second, additive, per-site layer —
`packages/themes/src/branding.ts` — sitting next to the untouched v0.3
`Theme`/`ThemeTokens`, not replacing or absorbing it.** Every file the v0.3
system already had (`themes` table, `theme.ts`, `resolve.ts`,
`theme-repository.ts`) is unchanged by this ADR. This is the "extend, don't
duplicate" instruction from the brief's own audit mandate, applied
literally: extend the _package_, not the _table_ or the _concept_ — the
two layers answer different questions ("which shared theme, with which
narrow overrides" vs. "this Site's own brand") and keeping them separate
means a future v0.9 to either one never has to reason about the other's
invariants.

## Decision 1 — domain model, versioned from day one

```ts
SiteBrandingV1 = {
  version: 1,
  brand: { name?, logo?: MediaReference, logoDark?: MediaReference, favicon?: MediaReference },
  colors: { background, surface, surfaceMuted, text, textMuted, primary, primaryForeground,
            secondary, secondaryForeground, accent, accentForeground, border,
            success?, warning?, danger? },
  typography: { heading: FontToken, body: FontToken },
  radius: { small: RadiusToken, medium: RadiusToken, large: RadiusToken },
  spacing: { section: SpacingToken },
  buttons: { primary: { style: ButtonStyleToken }, secondary: { style: ButtonStyleToken } },
  sections: { style: SectionStyleToken },
}
```

`SITE_BRANDING_VERSION = 1` is carried on every stored/resolved value and
on every frozen snapshot. `resolveSiteBranding(raw)` throws
`UnknownSiteBrandingVersionError` on anything but `1` — there is no silent
best-effort parse of a future, not-yet-understood shape. A `version: 2`
schema is additive from here: a second, explicitly-versioned parser
function and an upgrade path in `parseSiteSnapshot` (see Decision 6),
exactly mirroring how the snapshot format itself is already versioned.

Every leaf is a **closed enum or a validated primitive** — never an open
`Record<string, string>`, matching ADR 0011's "closed key set" reasoning
one level deeper (per-field values are closed too, not just field names).

## Decision 2 — colors: hex-only, allowlist, never a CSS function

`packages/validation/src/color.ts`'s `hexColorSchema` accepts only
`#RGB`/`#RRGGBB` (trimmed, lowercased on output) and rejects everything
else by construction — an **allowlist**, not a blocklist, the identical
pattern `safe-url.ts`'s `safeHrefSchema` already established for hrefs
(docs/SECURITY.md). `rgb()`, `hsl()`, named colors (`red`), `var(...)`,
`url(...)`, `expression(...)`, `javascript:`, `data:`, `blob:` schemes, and
CSS-breakout attempts (`</style><script>...`, `#fff;background:url(x)`)
are all rejected — tested explicitly in `color.test.ts` and again at the
`SiteBranding` layer in `branding.test.ts` (injection-payload coverage;
see Decision 12 / Security below). There is no code path where a tenant's
color string reaches a stylesheet, a `<style>` tag, or
`dangerouslySetInnerHTML` — every color flows through a plain React
`style={{ ... }}` object (see Decision 7), which the DOM's own style API
accepts as a value, never parses as a CSS statement.

## Decision 3 — typography: a closed, web-safe font-stack registry, no font URLs, no `next/font/google`

`FontToken = "system" | "modern-sans" | "classic-serif" | "elegant-serif" |
"monospace"`, each mapped to a fixed, fully web-safe CSS `font-family`
stack in `FONT_STACKS` (e.g. `"monospace"` → `"'SFMono-Regular', Consolas,
'Liberation Mono', monospace"`). A tenant picks a token; there is no field,
anywhere in the schema, that could hold a font URL, an `@import`, or an
arbitrary `font-family` string.

`next/font/google` was deliberately **not** used, even though it would
have allowed real branded webfonts: it requires an unverified build-time
network fetch to Google's CDN, which is a real risk in this sandboxed,
proxy-gated environment (see the environment's `HTTPS_PROXY` posture) and,
more importantly, is a per-_build_ resource, not a per-_site_ runtime
choice — it can't express "tenant A gets font X, tenant B gets font Y"
without generating a font subset per build. This is a disclosed,
deliberate limitation, not an oversight: `next/font/local` (once real
licensed font asset files exist in the repo) is the natural extension for
a future milestone. Shipping a conservative, honest 5-value system-font
registry now beats either lying about which font renders or risking a
broken production build.

## Decision 4 — logo/favicon: the existing Media system, UUID-only, never a raw URL

`brand.logo`/`brand.logoDark`/`brand.favicon` are all
`mediaReferenceSchema = z.object({ mediaId: uuidSchema })` — a reference
into the existing tenant-scoped `MediaAsset` catalog (`packages/content`),
the same primitive Hero/Gallery images already use. There is no field
anywhere in `SiteBranding` that could hold a raw external image URL. This
reuses the Media system's own upload/storage/tenant-isolation guarantees
completely rather than building a second, parallel asset pipeline.

## Decision 5 — persistence: a JSONB column, mirroring `theme_overrides`' own precedent

`sites.branding jsonb not null default '{}'` (migration 0015) — the same
shape as v0.3's `sites.theme_overrides`: the database stores the tenant's
own **delta**, not the fully-resolved object, so a future change to
`DEFAULT_SITE_BRANDING` automatically applies to every Site that never
overrode a given field, with no backfill migration required.
`updateSiteBranding` (`packages/sites`) validates via
`parseSiteBrandingOverrides` before writing, respects the same
tenant-scoped RLS transaction every other Site write already goes through,
and records a `SITE_BRANDING_UPDATED` audit action — no new abstraction,
no bypass of the existing write path.

A dedicated table was considered and rejected: `SiteBranding` has no
independent lifecycle (no history worth querying separately from the
Site itself, no cross-site sharing like the platform `themes` catalog has),
so a JSONB column on `sites` — exactly the existing `theme_overrides`
precedent — is the coherent choice, not a new join for every render.

## Decision 6 — publication snapshot: versioned upgrade chain, default-branding backfill for pre-v0.8 Revisions

`SNAPSHOT_SCHEMA_VERSION` bumps `2 → 3`; the new `siteSnapshotV3Schema`
adds a required `branding: siteBrandingV1Schema` field. `parseSiteSnapshot`
branches on the stored `version` (`undefined` → legacy v0.4 shape → `2` →
`3`), and **every older branch injects `DEFAULT_SITE_BRANDING`** when
normalizing forward — a Revision published before v0.8 existed still
parses and still renders, now with the platform's official default brand
identity, exactly satisfying "a pre-v0.8 site must keep working" (brief
§11) without a data migration touching a single historical row.

`assembleDraft` (`packages/publishing/src/draft-snapshot.ts`) resolves the
Site's stored `branding` override through `resolveSiteBranding` and
freezes the result into the snapshot at publish time, exactly like it
already did for `theme`/pages/navigation — the same "one pass both
validates and freezes" contract, extended to a second layer. This is what
makes the mandated invariant hold and is exercised directly by
`publish.test.ts`: **Draft branding A → publish rev N → public shows A →
draft becomes branding B → public still shows A → publish rev N+1 → public
shows B.**

## Decision 7 — brand media: publish-blocking content vs. gracefully-degrading chrome

Content-block media (`resolveMediaManifest`) has always been
publish-blocking on a missing reference (`media_reference_missing`) — a
Hero with a dangling `backgroundMediaId` is a real content defect worth
refusing to publish over. A logo/favicon is different: a missing or
stale logo reference should **never** stop a Site from publishing its
actual content. `resolveBrandMedia` (`packages/publishing/src/media-manifest.ts`)
is a deliberately separate function from `resolveMediaManifest`: it
silently drops an unresolvable `brand.logo`/`logoDark`/`favicon` reference
from the frozen snapshot rather than raising an issue — "a logo is chrome,
not content." Resolved brand media is deduplicated against content-block
media in the final snapshot's `media` array (one shared, deterministic
manifest, no double-fetch). Tested directly in
`draft-snapshot.test.ts`/`branding.spec.ts` ("a missing/stale logo
reference degrades gracefully — no broken image, no publish failure").

## Decision 8 — renderer resolution: one pure module, shared by Preview and Public by construction

`packages/renderer/src/resolve-branding.ts` exports three pure functions —
`createBrandingCssVariables(branding)`, `resolveButtonStyle(colors,
style)`, `resolveSectionStyle(branding)` — callable and fully testable
with no DOM (`resolve-branding.test.ts`, 12 tests). `RenderContext` gained
a required `branding: SiteBrandingV1` field (`render-context.ts`), resolved
once per request identically to `tokens`. `apps/web`'s public page shell
and `apps/admin`'s Preview page both call `resolveSiteBranding`/
`createBrandingCssVariables` through the exact same chain — there is no
`if (isPreview)` branch anywhere in this code, satisfying the brief's
"single renderer" requirement (§9/§15) by construction rather than by
convention. `apps/admin/e2e/site-branding.spec.ts` proves this at the
real-browser level: a color saved in the Appearance form appears in
Preview's rendered HTML before any publish.

## Decision 9 — CSS custom properties: a closed, additive `--site-*` set

`createBrandingCssVariables` emits a fixed set of custom properties
(`--site-color-primary`, `--site-radius-sm`, `--site-section-spacing`,
...) — variable **names** are decided entirely in code; a tenant only ever
supplies a **value** already validated against the closed schema. They are
spread into the existing inline `style` objects on the page-shell `<main>`
elements in both apps — **additive** to the pre-existing v0.3 token-driven
inline styles every block already used, not a replacement for them (see
Decision 10 for where the two layers meet on an actual rendered element).
No `<style>` tag, no client-side CSS-in-JS library, no runtime request:
the variables exist in the server-rendered HTML from the first byte.

## Decision 10 — a deliberate, documented boundary between the two layers on existing blocks

This is the one point where the "extend, don't duplicate" principle from
Decision 0 met a real trade-off, discovered during non-regression testing,
not designed in up front. `cta.tsx`/`hero.tsx` predate v0.8 and already
draw their CTA button's **color** from the pre-existing, per-site
`ThemeTokens` override (`t["color.primary"]`/`t["color.primaryContrast"]`
— ADR 0011's `sites.theme_overrides`, exercised by the seeded
`mas-du-luberon`/`villas-cassis` sites with their own distinct
`color.primary` values). An earlier version of this change made
`resolveButtonStyle` read `branding.colors.primary` directly — which
silently **discarded** that pre-existing override for every Site that
never separately configured the new v0.8 `SiteBranding` layer (i.e. every
Site that existed before this milestone), a real non-regression break
caught by `apps/web/e2e/resolution.spec.ts`'s own pre-existing assertion.

**Resolved by decoupling _color_ from _shape_:** `resolveButtonStyle` now
takes an explicit `{ base, foreground }` color pair plus a `ButtonStyleToken`
("solid"/"outline"/"ghost") — it no longer reads `branding.colors` itself.
`cta.tsx`/`hero.tsx` keep passing the pre-existing `ThemeTokens` colors as
`base`/`foreground` (byte-for-byte unchanged button color for every
already-configured Site) and now additionally pass
`branding.buttons.primary.style` for the button's _shape_. This is the
kernel phase's own answer to "where do `SiteBranding`'s button/section
tokens have a real, visible effect": shape (solid/outline/ghost,
flat/bordered/elevated) is driven by the new layer everywhere;
`property-summary.tsx`'s `resolveSectionStyle` call is unaffected by this
distinction since that block never had a background/border before v0.8 —
there was nothing to preserve there.

**The honest limitation this leaves:** on `cta.tsx`/`hero.tsx` specifically,
changing `SiteBranding`'s `colors.primary` in the new Appearance form does
not, by itself, recolor those two buttons — only their shape. The
`--site-color-primary` CSS variable is still correctly emitted and
available (Decision 9), and every _future_ branding-driven component is
free to consume `branding.colors.primary` directly with no such
constraint; this boundary is specific to the two pre-existing blocks that
already had a color source before this ADR. Documented here rather than
silently accepted, per the mission's own instruction to document any
divergence precisely rather than paper over it.

## Decision 11 — contrast/accessibility: non-blocking warning, never a silent rewrite

`packages/themes/src/contrast.ts` implements the standard WCAG relative-
luminance/contrast-ratio formulas and checks background/text,
primary/primaryForeground, and secondary/secondaryForeground against
`WCAG_AA_NORMAL_TEXT_RATIO = 4.5`. **Policy: warn, never block, never
auto-correct.** `updateSiteBrandingAction` (`apps/admin`) returns
`resolveContrastWarnings(branding)` alongside a successful save — the
tenant sees which pairs are hard to read and can choose to ignore the
warning. A hard validation gate was rejected: a tenant's chosen brand
colors are their own editorial choice (a deliberately monochrome or
high-contrast-elsewhere design might legitimately fail one narrow
automated check), and silently rewriting a color a tenant explicitly typed
would violate the "never silently modify the tenant's chosen colors"
instruction (brief §17) outright.

## Decision 12 — security: allowlist-first, no new injection surface, verified against the brief's exact payload list

- **No `dangerouslySetInnerHTML` anywhere in this feature** (grep-verified
  across `packages/renderer`, `packages/themes`, both apps) — every
  branding value renders through a plain React `style`/text prop, which
  React/the DOM style API escape by construction.
- **`hexColorSchema` is an allowlist**, not a blocklist — a value the
  schema doesn't recognize as `#RGB`/`#RRGGBB` is rejected outright, so no
  enumeration of "bad" values is needed to stay safe against a payload not
  yet imagined.
- **Every payload from the brief's own list is a unit test**, at both the
  validation layer (`color.test.ts`) and the domain layer
  (`branding.test.ts`): `javascript:alert(1)`, `url(javascript:alert(1))`,
  `expression(alert(1))`, `</style><script>alert(1)</script>`,
  `var(--evil)`, `data:text/html,...`, `blob:...` — all rejected.
  `resolve-branding.test.ts` additionally asserts every emitted `--site-*`
  CSS variable value is never shaped like any of these, end to end through
  resolution.
- **Fonts/logos/favicons have no free-text/URL surface at all** — see
  Decisions 3 and 4; there is structurally no field an injection payload
  could occupy for those categories.
- **A client component pulling in the database driver was found and
  fixed as a real build-time issue, not a runtime security bug**: see
  Decision 13.

## Decision 13 — a durable monorepo pattern: subpath exports for DB-free client-safe modules

`site-branding-form.tsx` (a `"use client"` component) needs real runtime
constants (`FONT_TOKENS`, `RADIUS_TOKENS`, ... — for `<select>` options),
not just types. Importing them from `@provence360/themes`'s root barrel
transitively pulled in `theme-repository.ts` → `@provence360/database` →
the Node-only `postgres` package into the browser bundle, breaking
`apps/admin`'s production build (`Module not found: 'fs'/'net'/'tls'`).
Fixed with a `package.json` `exports` subpath —
`"./branding": "./src/branding.ts"`, a module verified to depend on
nothing but `zod` and `@provence360/validation` — and importing from
`@provence360/themes/branding` instead of the package root. This is now
the established pattern for any future client component in this monorepo
that needs pure, DB-free constants from a package whose root barrel also
touches the database.

## Decision 14 — permission reuse: no new namespace

Branding reads/writes reuse the existing `theme.read`/`theme.update`
permissions rather than introducing `branding.read`/`branding.update`.
Both concepts answer "can this actor change how this Site looks," and a
tenant capable of picking a theme is the same tenant capable of setting
its brand identity — splitting them would double the permission surface
for a distinction with no real authorization difference in this system.
Documented here as a deliberate architectural-coherence choice, not an
oversight.

## Decision 15 — performance: SSR-only, zero client JS for base rendering

No client component was added for base branding rendering — the entire
feature is server-resolved, server-rendered `style` objects, present from
the first byte, with no flash-of-unstyled-content and no CSS network
request. The only client component in this feature is the pre-existing
Server-Action-backed Appearance form itself (admin-only, not part of the
public render path). `apps/web`'s public page shell gained a resolved
`branding`/`brandingVars`/`logo` computation, no additional database
queries beyond the Site row already being read for `tokens`/navigation.

## Out of scope (unchanged from the brief, §27)

Drag-and-drop builder, custom CSS/JS, a theme marketplace, many
pre-built templates, complex animations, a responsive layout editor,
WebGL, Matterport SDK/Mattertags, other 360 providers, analytics, CRM,
lead forms, A/B testing, AI-generated themes, Figma import, and
auto-generated theming from an existing site — none of this changes and
none of it was attempted.

## Consequences

- Migration 0015: `sites.branding jsonb not null default '{}'`. No table
  drop, no data migration — every existing Site resolves to
  `DEFAULT_SITE_BRANDING` until it explicitly overrides something.
- `SNAPSHOT_SCHEMA_VERSION` is now `3`; `siteSnapshotV2Schema` is kept
  internally (non-exported) purely to parse historical Revisions.
- New packages/modules: `packages/themes/src/branding.ts` + `contrast.ts`,
  `packages/renderer/src/resolve-branding.ts`,
  `packages/validation/src/color.ts`, a new `@provence360/themes/branding`
  subpath export.
- `packages/renderer/src/blocks/cta.tsx`/`hero.tsx`/`property-summary.tsx`
  now consume `SiteBranding`-derived shape (not color, for the first two —
  see Decision 10) alongside their existing `ThemeTokens` usage.
- `apps/admin` gains a new "Appearance" section on the Site detail page
  and a `branding`-aware Preview page; `apps/web`'s public page shell
  gains `--site-*` CSS variables, a resolved logo, and a favicon in
  `generateMetadata`.
- No regression to the v0.3 `Theme`/`ThemeTokens` system, the v0.4
  Publishing Kernel, v0.5 Composition Kernel, v0.6 Rental Domain, v0.7/
  v0.7.1 Virtual Tour features, or RLS/authorization — verified by the
  full pre-existing test suites (unit, integration, RLS, E2E) staying
  green, plus the specific `resolution.spec.ts` regression this ADR's
  Decision 10 documents catching and fixing.
