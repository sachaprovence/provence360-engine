import type { AppTx } from "@provence360/database";
import type { ThemeTokens } from "@provence360/themes";

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
 */
export interface RenderContext {
  tx: AppTx;
  tenantId: string;
  siteId: string;
  locale: string;
  defaultLocale: string;
  tokens: ThemeTokens;
}
