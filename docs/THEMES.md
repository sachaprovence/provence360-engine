# Themes

See [ADR 0011](adr/0011-theme-token-model.md) for why theming is a closed
token catalog rather than arbitrary CSS. This document is the reference
for the token set and how resolution works.

## The token catalog

`packages/themes/src/tokens.ts` defines a **closed** set of 19 semantic
keys — `themeTokensSchema` is `.strict()`, so a key outside this list is
rejected outright, never silently stripped:

```
color.background   color.surface       color.text
color.muted         color.primary       color.primaryContrast
color.accent
font.heading         font.body
radius.small         radius.medium       radius.large
spacing.small         spacing.medium      spacing.large
shadow.small           shadow.medium
container.narrow        container.wide
```

Every value is a plain, bounded string (`min(1).max(200)`) — a color, a
font stack, a CSS length. There is no key for "arbitrary CSS," "custom
HTML," or "inline `<style>` block" — a Theme (or an override) cannot
introduce one, because the schema that validates both is this exact,
closed set. This is the mechanism that makes "update the design system
across 200 sites" a single row edit instead of an audit of 200 independent
stylesheets.

## Theme (platform catalog)

`themes`: `id`, `key` (unique), `name`, `tokens` (JSONB, validated against
the schema above), `status` (active/deprecated). Not tenant-scoped —
readable by every tenant via a permissive RLS `SELECT` policy, writable
only by the platform admin role. There is no "create a theme" capability
exposed to a tenant in v0.3: a tenant _picks_ a theme and _narrowly
overrides_ it, never authors one from scratch — the same governance
reasoning as the Amenity catalog
([ADR 0012](adr/0012-media-asset-and-amenity-catalog.md)).

## Site overrides

`sites.themeOverrides` (JSONB) is validated against the **same closed
schema, `.partial()`** (`themeOverridesSchema = themeTokensSchema.partial()`)
— every key optional, but any key present must still be one of the 19 and
still be a valid value for it. A Site cannot introduce a token the base
schema doesn't know, and cannot smuggle non-token content through an
override any more than through the base theme itself.

## Resolution

`packages/themes/src/resolve.ts`'s `resolveTheme(baseTokens, overrides)`:

```
Resolved Theme = { ...BaseTheme.tokens, ...Site.themeOverrides }
```

A shallow merge — an override either replaces one named token's value
outright, or it doesn't apply. There's no structure inside a token value
for an override to partially reach into. If a Site has no `themeId` at
all (never configured), resolution falls back to
`FALLBACK_THEME_TOKENS` — a plain, neutral, hard-coded token set that
exists purely so no page is ever entirely unstyled; it is not meant to
look like a real theme a tenant would choose.

Both inputs are re-validated at resolution time, not trusted as
already-clean — `baseTokens` because it's platform-admin-written data that
still isn't implicitly trusted, `overrides` as cheap insurance even though
the write path (`updateSiteTheme` in `packages/sites`) already validated
them once.

`packages/renderer`'s `resolveSiteThemeTokens(tx, site)` is the one
function that ties this together for a request: fetch the Site's base
Theme row (if any) via `packages/themes`' `getTheme`, then call
`resolveTheme`. This is where `RenderContext.tokens` — the _only_ thing
block renderers ever read for styling — comes from (see
[docs/RENDERING.md](RENDERING.md)).

## Worked example

The seed data (`packages/database/src/scripts/seed.ts`) is the concrete
proof this works: **one** base theme (`provence`) is shared by both seeded
Sites. Villas Cassis overrides `color.primary` to an olive green
(`#6b7f3a`); Mas du Luberon overrides the same key to a blue
(`#3a5f7f`). Every other token — fonts, radii, spacing, shadows — comes
from the shared base and stays identical between the two sites. Changing
the base theme's `font.heading` would change both sites' headline font in
one `UPDATE`; changing `color.primary` on the base theme would change
every site's primary color _except_ the two that have overridden it. This
is the literal "Theme 'Provence' base + Villa des Oliviers overriding
primary=olive + Villa Azur overriding primary=blue" example from the
brief, realized.

## What's deliberately not built

- **No arbitrary CSS.** Not "not built yet" — explicitly ruled out as the
  _default_ path (see the ADR). A future, deliberately narrow escape hatch
  (e.g. a small closed set of pre-approved layout variants) is a
  documented possibility, not something this phase built even as an
  unused option.
- **No component/block-level theme variants.** The brief names these as a
  future theme capability; v0.3 ships only the token layer. Extending the
  closed catalog with a `variant.*` namespace later is additive.
- **No admin UI for authoring a new Theme.** The Site Editor lets an owner
  pick a theme and edit overrides (a small JSON form validated
  server-side against the same closed schema); it has no "create theme"
  screen, matching the platform-curated-catalog decision above.
