// WCAG 2.x contrast-ratio utilities (v0.8, section 17 of the brief). Pure
// math, no DOM — usable server-side (to compute a warning to show in the
// admin form) and in plain unit tests. Deliberately advisory-only: see
// `resolveContrastWarnings` below and docs/adr/0021-site-theme-branding-design-system.md
// for why this is a warning, not a hard validation that silently rejects
// or rewrites a tenant's chosen colors.

function hexToRgb(hex: string): [number, number, number] {
  const normalized =
    hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const value = Number.parseInt(normalized.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function relativeLuminanceChannel(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * relativeLuminanceChannel(r) +
    0.7152 * relativeLuminanceChannel(g) +
    0.0722 * relativeLuminanceChannel(b)
  );
}

/**
 * The standard WCAG contrast ratio between two colors, always >= 1
 * (identical colors) and <= 21 (pure black on pure white). Both inputs
 * must already be valid `#RGB`/`#RRGGBB` hex strings — see
 * `packages/validation`'s `hexColorSchema`, which every caller of this
 * function validates through first.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for normal-sized text — the threshold this module warns below. */
export const WCAG_AA_NORMAL_TEXT_RATIO = 4.5;

export interface ContrastWarning {
  pair: string;
  ratio: number;
  minimum: number;
}

/**
 * Checks the critical text/background color pairs a SiteBranding actually
 * renders text on top of, and returns a warning for every pair below WCAG
 * AA (4.5:1) — never throws, never modifies the input. The admin UI
 * surfaces these as non-blocking warnings (section 17: "ne pas modifier
 * silencieusement les couleurs choisies par l'utilisateur"); nothing in
 * this codebase ever auto-corrects a tenant's color choice.
 */
export function resolveContrastWarnings(branding: {
  colors: {
    background: string;
    text: string;
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
  };
}): ContrastWarning[] {
  const pairs: Array<[string, string, string]> = [
    ["background / text", branding.colors.background, branding.colors.text],
    ["primary / primaryForeground", branding.colors.primary, branding.colors.primaryForeground],
    [
      "secondary / secondaryForeground",
      branding.colors.secondary,
      branding.colors.secondaryForeground,
    ],
  ];

  const warnings: ContrastWarning[] = [];
  for (const [pair, a, b] of pairs) {
    const ratio = contrastRatio(a, b);
    if (ratio < WCAG_AA_NORMAL_TEXT_RATIO) {
      warnings.push({
        pair,
        ratio: Math.round(ratio * 100) / 100,
        minimum: WCAG_AA_NORMAL_TEXT_RATIO,
      });
    }
  }
  return warnings;
}
