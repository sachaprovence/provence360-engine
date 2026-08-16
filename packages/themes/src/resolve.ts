import { themeOverridesSchema, themeTokensSchema, type ThemeTokens } from "./tokens";

// The hard-coded fallback used when a Site has no `themeId` at all (a
// brand-new, not-yet-configured site) — never leave a page entirely
// unstyled. Deliberately plain and neutral: it is not meant to be a
// "real" theme any tenant would choose, only a safety net.
export const FALLBACK_THEME_TOKENS: ThemeTokens = {
  "color.background": "#ffffff",
  "color.surface": "#f4f4f5",
  "color.text": "#18181b",
  "color.muted": "#71717a",
  "color.primary": "#27272a",
  "color.primaryContrast": "#ffffff",
  "color.accent": "#3f3f46",
  "font.heading": "system-ui, sans-serif",
  "font.body": "system-ui, sans-serif",
  "radius.small": "4px",
  "radius.medium": "8px",
  "radius.large": "16px",
  "spacing.small": "8px",
  "spacing.medium": "16px",
  "spacing.large": "32px",
  "shadow.small": "0 1px 2px rgba(0,0,0,0.08)",
  "shadow.medium": "0 4px 12px rgba(0,0,0,0.12)",
  "container.narrow": "640px",
  "container.wide": "1200px",
};

/**
 * Resolves a Site's effective token set: the base Theme's tokens with the
 * Site's own overrides layered on top, key by key (docs/adr/0011-theme-token-model.md).
 * A shallow merge, deliberately — an override either replaces one named
 * token's value outright or it doesn't apply at all; there is no
 * structure inside a token value for an override to partially reach into.
 *
 * Both inputs are re-validated here rather than trusted as already-clean
 * — `baseTokens` comes from the `themes` table (admin/owner-written,
 * still not implicitly trusted) and `overrides` from `sites.theme_overrides`
 * (tenant-written). Throws (a Zod error) on a malformed base theme —
 * that's a platform-data bug, not something to silently paper over;
 * malformed overrides are the caller's responsibility to have already
 * rejected at write time (see `packages/themes`' write path), but
 * `.partial()` parsing here is cheap insurance regardless.
 */
export function resolveTheme(baseTokens: unknown, overrides: unknown = {}): ThemeTokens {
  const base = baseTokens ? themeTokensSchema.parse(baseTokens) : FALLBACK_THEME_TOKENS;
  const parsedOverrides = themeOverridesSchema.parse(overrides ?? {});

  const resolved = { ...base };
  for (const [key, value] of Object.entries(parsedOverrides)) {
    // `.partial()` types every key as `string | undefined`, even though a
    // key that's genuinely present in the parsed object always holds a
    // string (an override never explicitly sets a token to `undefined` —
    // it either overrides a key or omits it). Guarding here keeps the
    // merge honest without a type assertion.
    if (value !== undefined) resolved[key as keyof ThemeTokens] = value;
  }
  return resolved;
}
