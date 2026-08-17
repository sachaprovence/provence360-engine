import { z } from "zod";

// A closed color-value allowlist for tenant-facing design tokens (v0.8 —
// see docs/adr/0021-site-theme-branding-design-system.md). Same discipline
// as `safe-url.ts`'s `safeHrefSchema`: an allowlist of exactly what's
// accepted, not a blocklist of known-bad patterns — `rgb(...)`, `hsl(...)`,
// `var(...)`, `url(...)`, named colors ("red"), and any CSS function call
// are all rejected by construction, not because someone remembered to
// blocklist them. Only `#RGB` and `#RRGGBB` (case-insensitive hex) pass.
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/** Lowercases a valid hex color so `#FFF` and `#fff` resolve identically downstream. */
export function normalizeHexColor(value: string): string {
  return value.toLowerCase();
}

export const hexColorSchema = z
  .string()
  .trim()
  .refine(isHexColor, {
    message: "color must be a hex value in the form #RGB or #RRGGBB",
  })
  .transform(normalizeHexColor);
