import { z } from "zod";
import { hexColorSchema, uuidSchema } from "@provence360/validation";

// v0.8 — Site Theme, Branding & Design System Kernel (see
// docs/adr/0021-site-theme-branding-design-system.md). This module is a
// SECOND, additive layer on top of the v0.3 Theme system (`tokens.ts`/
// `resolve.ts`): the platform-curated `ThemeTokens` catalog (base
// palette/typography/radius/spacing/shadows, shared across many sites) is
// unchanged, and `SiteBranding` is the genuinely per-tenant customization
// layer — brand identity (name/logo/favicon), an expanded semantic color
// set, a closed typography registry, and closed button/section style
// modes. Both layers are resolved together into the final render-time
// values (see `resolve-branding.ts` in `packages/renderer`); neither one
// replaces the other.
//
// Every rule ADR 0011 established for `ThemeTokens` applies identically
// here: a closed set of keys (`.strict()`), a closed set of *value*
// shapes (hex colors, closed enums — never a free-form string a tenant
// could turn into `customCss`), and a version tag so a future v2 can
// extend this without breaking an already-published Revision's frozen
// snapshot (section 12 of the brief).

export const SITE_BRANDING_VERSION = 1 as const;

// --- Media references ---------------------------------------------------
//
// A logo/favicon is a reference to an existing MediaAsset — never a raw
// URL a tenant could point anywhere. Resolved through the exact same
// `resolveMediaDescriptor`/frozen-manifest pipeline every other block's
// media reference already uses (`packages/renderer/src/resolve-media.ts`)
// — no second media system.
export const mediaReferenceSchema = z.object({
  mediaId: uuidSchema,
});
export type MediaReference = z.infer<typeof mediaReferenceSchema>;

// --- Typography: a closed registry, never a font URL --------------------
//
// Deliberately CSS font-family *stacks* built entirely from system/
// web-safe fonts — zero external font files, zero runtime request to any
// font provider (Google Fonts or otherwise), zero build-time network
// dependency. A tenant picks one of these five; there is no way to name a
// font this registry doesn't already know, and therefore no way to smuggle
// a `url(...)` or an arbitrary `@import` through this field. See the ADR's
// "Fonts" section for why self-hosting real branded webfonts (via
// `next/font/local`, once real font asset files exist) is the natural next
// step, deliberately deferred rather than built against an unverified
// build-time network dependency.
export const FONT_TOKENS = [
  "system",
  "modern-sans",
  "classic-serif",
  "elegant-serif",
  "monospace",
] as const;
export const fontTokenSchema = z.enum(FONT_TOKENS);
export type FontToken = (typeof FONT_TOKENS)[number];

export const FONT_STACKS: Record<FontToken, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  "modern-sans": "'Helvetica Neue', Helvetica, Arial, sans-serif",
  "classic-serif": "Georgia, 'Times New Roman', serif",
  "elegant-serif": "'Playfair Display', Georgia, serif",
  monospace: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
};

// --- Radius / spacing: closed scale steps, not raw CSS lengths ----------

export const RADIUS_TOKENS = ["none", "small", "medium", "large", "full"] as const;
export const radiusTokenSchema = z.enum(RADIUS_TOKENS);
export type RadiusToken = (typeof RADIUS_TOKENS)[number];

export const RADIUS_VALUES: Record<RadiusToken, string> = {
  none: "0px",
  small: "4px",
  medium: "10px",
  large: "20px",
  full: "9999px",
};

export const SPACING_TOKENS = ["compact", "cozy", "comfortable", "spacious"] as const;
export const spacingTokenSchema = z.enum(SPACING_TOKENS);
export type SpacingToken = (typeof SPACING_TOKENS)[number];

export const SPACING_VALUES: Record<SpacingToken, string> = {
  compact: "24px",
  cozy: "40px",
  comfortable: "64px",
  spacious: "96px",
};

// --- Buttons / sections: closed style modes, not arbitrary CSS ----------

export const BUTTON_STYLE_TOKENS = ["solid", "outline", "ghost"] as const;
export const buttonStyleTokenSchema = z.enum(BUTTON_STYLE_TOKENS);
export type ButtonStyleToken = (typeof BUTTON_STYLE_TOKENS)[number];

export const SECTION_STYLE_TOKENS = ["flat", "bordered", "elevated"] as const;
export const sectionStyleTokenSchema = z.enum(SECTION_STYLE_TOKENS);
export type SectionStyleToken = (typeof SECTION_STYLE_TOKENS)[number];

// --- The full, resolved SiteBranding shape -------------------------------

const brandSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  logo: mediaReferenceSchema.optional(),
  logoDark: mediaReferenceSchema.optional(),
  favicon: mediaReferenceSchema.optional(),
});
export type SiteBrandingBrand = z.infer<typeof brandSchema>;

const colorsSchema = z
  .object({
    background: hexColorSchema,
    surface: hexColorSchema,
    surfaceMuted: hexColorSchema,
    text: hexColorSchema,
    textMuted: hexColorSchema,
    primary: hexColorSchema,
    primaryForeground: hexColorSchema,
    secondary: hexColorSchema,
    secondaryForeground: hexColorSchema,
    accent: hexColorSchema,
    accentForeground: hexColorSchema,
    border: hexColorSchema,
    success: hexColorSchema.optional(),
    warning: hexColorSchema.optional(),
    danger: hexColorSchema.optional(),
  })
  .strict();
export type SiteBrandingColors = z.infer<typeof colorsSchema>;

const typographySchema = z
  .object({
    heading: fontTokenSchema,
    body: fontTokenSchema,
  })
  .strict();

const radiusSchema = z
  .object({
    small: radiusTokenSchema,
    medium: radiusTokenSchema,
    large: radiusTokenSchema,
  })
  .strict();

const spacingSchema = z
  .object({
    section: spacingTokenSchema,
  })
  .strict();

const buttonsSchema = z
  .object({
    primary: z.object({ style: buttonStyleTokenSchema }).strict(),
    secondary: z.object({ style: buttonStyleTokenSchema }).strict(),
  })
  .strict();

const sectionsSchema = z
  .object({
    style: sectionStyleTokenSchema,
  })
  .strict();

export const siteBrandingV1Schema = z
  .object({
    version: z.literal(SITE_BRANDING_VERSION),
    brand: brandSchema,
    colors: colorsSchema,
    typography: typographySchema,
    radius: radiusSchema,
    spacing: spacingSchema,
    buttons: buttonsSchema,
    sections: sectionsSchema,
  })
  .strict();

export type SiteBrandingV1 = z.infer<typeof siteBrandingV1Schema>;

// --- Overrides: the same shape, every leaf optional ----------------------
//
// What a Site actually stores (`sites.branding`) and what the admin form
// writes — a deep-partial version of `siteBrandingV1Schema`, layered onto
// `DEFAULT_SITE_BRANDING` by `resolveSiteBranding` below. Hand-written
// (not a generic `.deepPartial()`) for the same reason `themeOverridesSchema`
// is hand-kept alongside `themeTokensSchema`: this shape is shallow enough
// (two levels) that an explicit schema is clearer than a generic utility,
// and it keeps `.strict()` enforced at every level — an override object
// can narrow a known key's value, never introduce an unknown one.
export const siteBrandingOverridesV1Schema = z
  .object({
    version: z.literal(SITE_BRANDING_VERSION).optional(),
    brand: brandSchema.optional(),
    colors: colorsSchema.partial().strict().optional(),
    typography: typographySchema.partial().strict().optional(),
    radius: radiusSchema.partial().strict().optional(),
    spacing: spacingSchema.partial().strict().optional(),
    buttons: z
      .object({
        primary: z.object({ style: buttonStyleTokenSchema }).strict().optional(),
        secondary: z.object({ style: buttonStyleTokenSchema }).strict().optional(),
      })
      .strict()
      .optional(),
    sections: sectionsSchema.partial().strict().optional(),
  })
  .strict();

export type SiteBrandingOverrides = z.infer<typeof siteBrandingOverridesV1Schema>;

// --- Default theme ---------------------------------------------------------
//
// The one, official Provence360 default — applied whenever a Site has no
// `branding` configured yet (a brand-new site, or any site created before
// v0.8). No component recomputes its own defaults; every consumer reads
// this constant. Colors deliberately match `FALLBACK_THEME_TOKENS`
// (`resolve.ts`) so a freshly created, unconfigured site looks identical
// under both the v0.3 token layer and the v0.8 branding layer — one
// coherent "no configuration yet" appearance, not two different ones.
export const DEFAULT_SITE_BRANDING: SiteBrandingV1 = {
  version: SITE_BRANDING_VERSION,
  brand: {},
  colors: {
    background: "#ffffff",
    surface: "#f4f4f5",
    surfaceMuted: "#e4e4e7",
    text: "#18181b",
    textMuted: "#71717a",
    primary: "#27272a",
    primaryForeground: "#ffffff",
    secondary: "#3f3f46",
    secondaryForeground: "#ffffff",
    accent: "#3f3f46",
    accentForeground: "#ffffff",
    border: "#e4e4e7",
  },
  typography: {
    heading: "system",
    body: "system",
  },
  radius: {
    small: "small",
    medium: "medium",
    large: "large",
  },
  spacing: {
    section: "cozy",
  },
  buttons: {
    primary: { style: "solid" },
    secondary: { style: "outline" },
  },
  sections: {
    style: "flat",
  },
};

export class UnknownSiteBrandingVersionError extends Error {
  constructor(public readonly version: unknown) {
    super(`Site branding has an unknown version: ${JSON.stringify(version)}`);
    this.name = "UnknownSiteBrandingVersionError";
  }
}

function mergeSection<T extends object>(
  base: T,
  override: { [K in keyof T]?: T[K] | undefined } | undefined,
): T {
  if (!override) return base;
  return { ...base, ...override };
}

/**
 * Resolves a Site's effective branding: `DEFAULT_SITE_BRANDING` with the
 * Site's own stored overrides layered on top, one section at a time
 * (shallow merge within each section — `colors`, `typography`, etc. —
 * mirroring `resolveTheme`'s own per-key shallow merge, one level deeper
 * to match this shape's nesting). `raw` is whatever is currently stored in
 * `sites.branding` (or a Revision snapshot's own frozen `branding` field);
 * `null`/`undefined`/`{}` (no `version` key — an unconfigured site, or one
 * created before v0.8) resolves straight to the default, never an error —
 * this is the backward-compatibility guarantee section 11 of the brief
 * requires. A `version` present but not `1` is a genuinely unrecognized
 * future format and fails closed, the same posture `parseSiteSnapshot`
 * takes on an unknown `schemaVersion`.
 */
export function resolveSiteBranding(raw: unknown): SiteBrandingV1 {
  if (raw === null || raw === undefined) return DEFAULT_SITE_BRANDING;
  if (typeof raw !== "object") return DEFAULT_SITE_BRANDING;

  const maybeVersion = (raw as { version?: unknown }).version;
  if (maybeVersion === undefined) return DEFAULT_SITE_BRANDING;
  if (maybeVersion !== SITE_BRANDING_VERSION) {
    throw new UnknownSiteBrandingVersionError(maybeVersion);
  }

  const overrides = siteBrandingOverridesV1Schema.parse(raw);

  return {
    version: SITE_BRANDING_VERSION,
    brand: overrides.brand ?? DEFAULT_SITE_BRANDING.brand,
    colors: mergeSection(DEFAULT_SITE_BRANDING.colors, overrides.colors),
    typography: mergeSection(DEFAULT_SITE_BRANDING.typography, overrides.typography),
    radius: mergeSection(DEFAULT_SITE_BRANDING.radius, overrides.radius),
    spacing: mergeSection(DEFAULT_SITE_BRANDING.spacing, overrides.spacing),
    buttons: {
      primary: overrides.buttons?.primary ?? DEFAULT_SITE_BRANDING.buttons.primary,
      secondary: overrides.buttons?.secondary ?? DEFAULT_SITE_BRANDING.buttons.secondary,
    },
    sections: mergeSection(DEFAULT_SITE_BRANDING.sections, overrides.sections),
  };
}

/**
 * Validates a raw overrides payload (what an admin write actually stores
 * into `sites.branding`) without resolving it against the default — the
 * write path (`updateSiteBranding`) stores exactly what the tenant chose
 * to override, never the fully-resolved object, so a later change to
 * `DEFAULT_SITE_BRANDING` still applies to every site that never
 * overrode the field in question. Throws on anything structurally
 * invalid — an unknown key, a non-hex color, an unrecognized font/radius/
 * spacing/button/section token.
 */
export function parseSiteBrandingOverrides(raw: unknown): SiteBrandingOverrides {
  return siteBrandingOverridesV1Schema.parse(raw ?? {});
}
