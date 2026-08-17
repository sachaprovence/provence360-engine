import type { AppTx } from "@provence360/database";
import type { ThemeTokens } from "@provence360/themes";

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
 */
export interface RenderContext {
  tx: AppTx;
  tenantId: string;
  siteId: string;
  locale: string;
  defaultLocale: string;
  tokens: ThemeTokens;
  media?: ReadonlyMap<string, FrozenMediaDescriptor> | undefined;
}
