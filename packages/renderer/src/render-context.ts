import type { AppTx } from "@provence360/database";
import type { SiteBrandingV1, ThemeTokens } from "@provence360/themes";

/**
 * The minimal shape a block renderer needs to draw a referenced media
 * asset — structurally compatible with (a subset of)
 * `packages/publishing`'s `MediaDescriptor`, deliberately declared locally
 * rather than imported from that package: `packages/renderer` has no
 * dependency on `packages/publishing` (see docs/ARCHITECTURE.md's
 * dependency graph) and shouldn't gain one just to name this type — a
 * frozen descriptor object built anywhere else in the codebase is already
 * assignable here by structure.
 */
export interface FrozenMediaDescriptor {
  id: string;
  storageKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string | null;
}

/**
 * Everything a block renderer is allowed to know at render time (section
 * 22 of the brief). `tx` is the RLS-scoped transaction already bound to
 * `tenantId` via `withTenantContext()` — a domain-bound block loads real
 * data through it (via `packages/rentals`), it never opens its own
 * connection or accepts a raw tenant id from anywhere else. `locale` is
 * the requested display locale; `defaultLocale` is the Site's own
 * fallback (see `resolveLocalizedString` in `packages/content`). `tokens`
 * is the already-resolved theme (`resolveTheme()` — base + site overrides
 * merged), never the raw base theme or raw overrides individually.
 * `branding` (v0.8) is the sibling resolved value for the second,
 * per-tenant branding layer (`resolveSiteBranding()` — `DEFAULT_SITE_BRANDING`
 * + Site's own overrides merged), always present, never the raw stored
 * overrides — see `packages/renderer/src/resolve-branding.ts` and
 * docs/adr/0021-site-theme-branding-design-system.md.
 *
 * `media` (v0.5, optional): when rendering a **published** Revision, this
 * is the Revision's own frozen media manifest, keyed by MediaAsset id — a
 * Hero/Gallery block must resolve its referenced ids from here, never a
 * live `tx` lookup, so an already-published Revision's appearance can
 * never change because a MediaAsset row was edited afterward (section 9 of
 * the v0.5 brief). `undefined` when rendering a Draft **preview**
 * (`apps/admin/.../preview`) — there is, by definition, no frozen anything
 * to render yet, so those blocks fall back to their pre-v0.5 live `tx`
 * lookup, which is the semantically correct behavior for a preview (it
 * must show *today's* draft media, not a manifest that doesn't exist).
 * See docs/PUBLISHING.md#media.
 *
 * `publicOnly` (v0.6, optional): mirrors `media`'s own draft/published
 * split, one level down, for Rental *business* data rather than frozen
 * presentation. `true` when rendering for an actual public visitor:
 * domain-bound blocks (`property-summary`, `unit-grid`, `amenities`) then
 * only resolve Property/Unit rows that are currently public
 * (`isPublicPropertyStatus`/`isPublicUnitStatus` in `@provence360/rentals`)
 * and apply the Property's `locationDisclosure` filtering to any address
 * shown. `undefined`/`false` for admin draft-preview: an owner previewing
 * their own Site sees the full live row regardless of status or
 * disclosure, since they're editing it, not visiting as a guest. This is
 * deliberately independent of `media` (a page can be a published preview
 * with frozen media before a Property referenced by it is even active) -
 * see docs/adr/0018-rental-domain-guest-experience.md.
 */
export interface RenderContext {
  tx: AppTx;
  tenantId: string;
  siteId: string;
  locale: string;
  defaultLocale: string;
  tokens: ThemeTokens;
  branding: SiteBrandingV1;
  media?: ReadonlyMap<string, FrozenMediaDescriptor> | undefined;
  publicOnly?: boolean | undefined;
}
