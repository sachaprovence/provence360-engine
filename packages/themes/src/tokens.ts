import { z } from "zod";

// The closed, semantic design-token catalog (docs/adr/0011-theme-token-model.md
// and docs/THEMES.md). This is the ONLY place valid token keys are
// decided — a theme's `tokens` and a site's `themeOverrides` are both
// validated against this exact shape, so neither can introduce a token
// name the renderer doesn't know about, or hold a value that isn't a
// plain string (raw CSS, a `<style>` tag, a `javascript:` URL).
//
// NOTE: `THEME_TOKEN_KEYS` (used by admin UI to enumerate editable
// tokens) is hand-kept in sync with the schema below — there are few
// enough tokens in v0.3 that generating one from the other isn't worth
// the added indirection yet.
const tokenValue = z.string().trim().min(1).max(200);

export const themeTokensSchema = z
  .object({
    "color.background": tokenValue,
    "color.surface": tokenValue,
    "color.text": tokenValue,
    "color.muted": tokenValue,
    "color.primary": tokenValue,
    "color.primaryContrast": tokenValue,
    "color.accent": tokenValue,
    "font.heading": tokenValue,
    "font.body": tokenValue,
    "radius.small": tokenValue,
    "radius.medium": tokenValue,
    "radius.large": tokenValue,
    "spacing.small": tokenValue,
    "spacing.medium": tokenValue,
    "spacing.large": tokenValue,
    "shadow.small": tokenValue,
    "shadow.medium": tokenValue,
    "container.narrow": tokenValue,
    "container.wide": tokenValue,
  })
  // Closed catalog, enforced: an unrecognized key (not just a wrong-typed
  // known one) is rejected outright, never silently stripped — see
  // docs/adr/0011-theme-token-model.md.
  .strict();

export type ThemeTokens = z.infer<typeof themeTokensSchema>;

export const THEME_TOKEN_KEYS = Object.keys(themeTokensSchema.shape) as ReadonlyArray<
  keyof ThemeTokens
>;

// Overrides are the exact same closed shape, just every key optional —
// `sites.theme_overrides` can narrow the base theme's tokens, never
// extend it with a key the base schema doesn't recognize.
export const themeOverridesSchema = themeTokensSchema.partial();

export type ThemeOverrides = z.infer<typeof themeOverridesSchema>;
