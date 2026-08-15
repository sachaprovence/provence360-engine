# Rendering

How `Host → Site → Page → Content → Domain data → Theme` becomes an actual
response. The renderer itself lives in `packages/renderer`; nothing in it
is per-client — the same code renders every seeded site (see
`packages/database/src/scripts/seed.ts`'s "Villa des Oliviers" and "Mas du
Luberon," which differ only in data, never in code).

## The resolution pipeline

```
Host -> DomainResolver -> Site -> Page -> Content -> Domain data -> Theme -> Renderer
```

Extending [docs/ARCHITECTURE.md](ARCHITECTURE.md)'s v0.1 pipeline
(`Host -> DomainResolver -> Site -> Tenant -> PublishedRelease -> Renderer`)
now that a real Renderer and Content Graph exist. Concretely
(`apps/web/app/page.tsx`):

1. **Host → Site/Tenant** — unchanged from v0.1/v0.2: `resolveSiteByHostname`
   via the narrow `provence360_resolver` role, no tenant context yet.
2. **Site** — once `tenantId` is known, `withTenantContext(tenantId, ...)`
   opens an RLS-scoped transaction and the Site row is read through it.
3. **Page** — `getPageBySlug(tx, site.id, "")` for the home page (see
   [docs/CONTENT_MODEL.md](CONTENT_MODEL.md) for why HOME uses an empty
   slug).
4. **Theme** — `resolveSiteThemeTokens(tx, site)` (see
   [docs/THEMES.md](THEMES.md)) produces the resolved `ThemeTokens`.
5. **Content → Domain data → Renderer** — `renderBlocks(page.content,
context)` walks the page's block array in order, and each domain-bound
   block loads its own Property/Unit/Amenity/Media data through the same
   `tx` as it renders (see [docs/BLOCK_SYSTEM.md](BLOCK_SYSTEM.md)).

The Site resolved by hostname is the **only** source of truth for which
tenant a request belongs to — nothing the browser sends (a cookie, a
header, a query parameter) can override it. This is invariant 7 of
[docs/SITE_DOMAIN.md](SITE_DOMAIN.md#twelve-invariants).

## RenderContext

```ts
interface RenderContext {
  tx: AppTx; // the RLS-scoped transaction, already bound to tenantId
  tenantId: string;
  siteId: string;
  locale: string; // requested display locale
  defaultLocale: string; // the Site's own fallback (see LOCALIZATION.md)
  tokens: ThemeTokens; // already-resolved (base + overrides merged)
}
```

Every block renderer receives exactly this, plus its own already-validated
`props`. There is no other way for a block component to reach the
database — `tx` is the _only_ handle, and it's already tenant-scoped, so a
domain-bound block cannot accidentally (or deliberately) query outside its
own tenant's data even if it tried. No deep presentation component ever
opens its own connection or accepts a tenant id from anywhere else (see
[docs/SECURITY.md](SECURITY.md)).

## Data loading and query count

Each domain-bound block issues **one batched query** for its own data —
`getProperty` (1 row), `listUnitsForProperty` (1 query, ordered),
`listAmenitiesForUnit` (1 joined query), `listMediaAssetsByIds` (1
`IN (...)` query for however many media ids a Gallery/Hero references).
There is no N+1 inside any single block — a Gallery with 10 images issues
one query, not ten.

Measured on the seeded Villas Cassis homepage (all 8 block types present:
Hero, Text, Gallery, FeatureList, PropertySummary, UnitGrid, Amenities,
CTA):

| Step                           | Queries |
| ------------------------------ | ------- |
| Hostname resolution            | 1       |
| Site row                       | 1       |
| Page row                       | 1       |
| Theme row                      | 1       |
| Hero (background media lookup) | 1       |
| Gallery (3 media ids, batched) | 1       |
| PropertySummary                | 1       |
| UnitGrid                       | 1       |
| Amenities                      | 1       |
| **Total**                      | **9**   |

Text, FeatureList, and CTA are pure content blocks — zero queries. The
Mas du Luberon homepage (no Gallery/Amenities block) renders in 7. None of
this is prematurely micro-optimized — it's the natural result of "one
batched query per data need," not a caching layer.

**Future caching points**, documented rather than built: the resolved
Site row, the resolved Theme tokens, and — once a Draft/Release pipeline
exists (see [docs/ROADMAP.md](ROADMAP.md)) — an entire rendered Page are
all naturally per-Site/per-Release cacheable with targeted invalidation
(a Site's cache key changes when its Page, Theme, or referenced domain
data changes). Static/ISR rendering per Site and CDN-level caching of the
final HTML are both straightforward once a Release concept exists to key
the cache on, since "live" content (today) has no stable version to cache
against.

## Error handling

Every stored block instance is handled independently — see
[docs/BLOCK_SYSTEM.md](BLOCK_SYSTEM.md#error-handling-an-unrecognized-block-never-crashes-the-page)
for the full contract. The short version: a malformed envelope, an
unknown `type@version`, invalid props, or a missing renderer all degrade
to an inert placeholder for that one block — the rest of the page renders
normally, and the failure is logged
(`renderer.block.invalid`/`.no_renderer`/`.render_failed`).

A **domain reference that resolves to nothing** — a `propertyId`/`unitId`
that's been deleted, or (the adversarial case) belongs to another tenant
— is handled the same way, one level up: `PropertySummary`, `UnitGrid`,
and `Amenities` all render a generic `DomainReferenceUnavailable`
placeholder (`data-block-unavailable="true"`) rather than throwing.
Crucially, the placeholder never echoes the reference id or any other
detail — an attacker probing block references learns nothing more than
"unavailable," whether the underlying reason is "deleted" or "not yours."
This is exercised directly by an adversarial renderer test
(`render-page.test.tsx`): Tenant A's block referencing Tenant B's real
Property renders the placeholder, never Tenant B's actual name/address.

## Security

- **No `dangerouslySetInnerHTML` anywhere in `packages/renderer`.** Text
  content (a Hero headline, a Text block's body) is always rendered as
  plain JSX children — React escapes it by default. There is no rich-text
  block in v0.3; if one is added later, its content must be structured and
  sanitized, never raw HTML passed through unchanged.
- **No arbitrary CSS, no arbitrary iframes.** Styling comes exclusively
  from `RenderContext.tokens` (see [docs/THEMES.md](THEMES.md)); there is
  no block prop, anywhere, typed to hold a `<style>` block, an inline
  `style` string a tenant controls beyond the closed token set, or an
  iframe `src`.
- **Every href is validated at write time**, not just escaped at render
  time. `packages/validation/src/safe-url.ts`'s `safeHrefSchema` — used by
  every block with a link (`hero.ctaHref`, `cta.buttonHref`) — is a closed
  allowlist: a relative path (`/contact`), a same-page fragment
  (`#gallery`), or an absolute `http(s)://` URL. Everything else,
  including `javascript:`, `data:`, `vbscript:`, and **protocol-relative**
  URLs (`//evil.com` — which a browser resolves against the current
  page's own scheme exactly like a full absolute URL would, and which an
  earlier draft of this schema incorrectly accepted; see the regression
  test in `safe-url.test.ts`), is rejected at the point content is saved,
  never merely stripped or escaped later.
- **Slugs can never contain a path-traversal sequence** — see
  [docs/CONTENT_MODEL.md](CONTENT_MODEL.md#slugs); `normalizeSlug` has an
  explicit regression test proving `../../etc/passwd`-style input
  normalizes to plain, safe segments, never survives as `..`/`/`.
- **A tenant-scoped lookup that finds nothing returns nothing, never an
  error that could distinguish "doesn't exist" from "not yours."** This is
  the same fail-closed contract `packages/domains`/`packages/auth`
  established in v0.1/v0.2, extended to every new resource type.
