import type { AppTx } from "@provence360/database";
import { getTheme, resolveTheme, type ThemeTokens } from "@provence360/themes";

/**
 * The last leg of the resolution pipeline (section 23 of the brief):
 * Site -> base Theme -> resolved tokens. A Site with no `themeId` (never
 * configured) resolves against `FALLBACK_THEME_TOKENS` via `resolveTheme`
 * itself — this function only fetches the base Theme row, it never
 * decides the fallback.
 */
export async function resolveSiteThemeTokens(
  tx: AppTx,
  site: { themeId: string | null; themeOverrides: unknown },
): Promise<ThemeTokens> {
  const theme = site.themeId ? await getTheme(tx, site.themeId) : null;
  return resolveTheme(theme?.tokens, site.themeOverrides);
}
