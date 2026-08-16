# ADR 0011: A closed, semantic design-token catalog — no arbitrary CSS

## Status

Accepted.

## Context

Section 19-21 of the v0.3 brief is explicit about the failure mode this
ADR exists to prevent: `customCss: string` (or any equivalent escape
hatch) as the _primary_ theming mechanism. It looks like the fastest way
to make Villa des Oliviers and Villa Azur look different — and it is,
right up until site #40 needs a change that should apply everywhere, and
now means auditing forty independent CSS blobs instead of editing one
token. The engine exists to serve "hundreds of sites from one codebase";
an escape hatch that lets each site opt out of the shared design system
is a slow-motion fork, one deployment at a time.

The question this ADR answers: what does a `Theme` actually contain, and
how does a per-site customization ("Villa des Oliviers is olive-green,
Villa Azur is blue") happen without either forking the renderer or
granting arbitrary styling power.

## Decision

- **Themes are a closed, semantic **token** catalog**, not stylesheets. `themes.tokens` (JSONB, validated by `packages/themes`' Zod schema — never trusted as opaque JSON) holds namespaced keys: `color.background`, `color.surface`, `color.text`, `color.muted`, `color.primary`, `color.primaryContrast`, `color.accent`, `font.heading`, `font.body`, `radius.small/medium/large`, `spacing.*`, `shadow.*`, `container.*`. The **set of valid keys is closed** — defined once in `packages/themes/src/tokens.ts` — not an open `Record<string, string>` a theme (or an override) could extend with an arbitrary new key.
- **Themes are a platform-level catalog** (see `docs/adr/0012-media-asset-and-amenity-catalog.md` for the identical reasoning applied to `amenities`): not tenant-scoped, readable by every tenant, writable only by the admin/owner role in v0.3. There is no "create a theme" capability exposed to a tenant — a tenant _picks_ a theme (`sites.theme_id`) and _narrowly overrides_ it (`sites.theme_overrides`), it does not author one from scratch. This keeps the whole catalog governable: a platform operator can audit every theme in existence by reading one table, not by inspecting hundreds of tenant-authored variants.
- **Overrides are validated against the exact same closed token schema as the base theme**, just partial (every key optional) — `sites.theme_overrides` cannot introduce a token name the base schema doesn't recognize, and cannot hold a non-token value (raw CSS, a `<style>` tag, a `javascript:` URL — anything outside "a value shaped like this specific token"). **Resolution** (`packages/themes/src/resolve.ts`) is `{ ...baseTheme.tokens, ...site.themeOverrides }` — shallow merge, override wins per-key, never a deep/recursive merge that could let an override reach into structure the base didn't expose.
- **No component-variant escape hatch in v0.3.** The brief mentions "component variants, block variants" as things a theme _could_ eventually define; v0.3 ships only the token layer. Extending the closed catalog with a `variant.*` namespace later is additive (new keys, same validation shape), not a redesign.

## Consequences

- "Change the primary color across 200 sites" (brief, section 47.D) is one `UPDATE themes SET tokens = ...` — every site using that theme picks it up automatically; a site with an override on `color.primary` specifically keeps its own value, everything else follows the base. No per-site migration, no fork.
- A new theme (brief, section 47.C) is a new catalog row — the renderer needs zero code changes, since it only ever consumes the resolved token set through the same fixed keys.
- The tradeoff: a theme genuinely cannot do everything arbitrary CSS could (an unusual one-off layout for a single site isn't expressible through tokens alone). Accepted deliberately — see section 21 of the brief: "if an escape hatch is ever needed, document it, don't build it as the default path." Nothing here forecloses a future, deliberately narrow escape hatch (e.g. a small set of pre-approved layout variants); it forecloses defaulting to one.
