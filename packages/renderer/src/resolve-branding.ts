import {
  FONT_STACKS,
  RADIUS_VALUES,
  SPACING_VALUES,
  type ButtonStyleToken,
  type SiteBrandingV1,
} from "@provence360/themes";

/**
 * The closed, fixed set of CSS custom properties a SiteBranding resolves
 * to (v0.8, section 10 of the brief). Names are decided entirely here —
 * a tenant never chooses a variable name, only a value from the closed
 * token set `packages/themes`' Zod schemas already enforce. Pure and
 * server-side only: called once per page render (`apps/web`'s page shell
 * and `apps/admin`'s Preview page), emitted as a plain inline `style`
 * object on the page's root element — no client JS, no `<style>` tag, no
 * runtime CSS-in-JS library.
 */
export function createBrandingCssVariables(branding: SiteBrandingV1): Record<string, string> {
  return {
    "--site-color-background": branding.colors.background,
    "--site-color-surface": branding.colors.surface,
    "--site-color-surface-muted": branding.colors.surfaceMuted,
    "--site-color-text": branding.colors.text,
    "--site-color-text-muted": branding.colors.textMuted,
    "--site-color-primary": branding.colors.primary,
    "--site-color-primary-foreground": branding.colors.primaryForeground,
    "--site-color-secondary": branding.colors.secondary,
    "--site-color-secondary-foreground": branding.colors.secondaryForeground,
    "--site-color-accent": branding.colors.accent,
    "--site-color-accent-foreground": branding.colors.accentForeground,
    "--site-color-border": branding.colors.border,
    ...(branding.colors.success ? { "--site-color-success": branding.colors.success } : {}),
    ...(branding.colors.warning ? { "--site-color-warning": branding.colors.warning } : {}),
    ...(branding.colors.danger ? { "--site-color-danger": branding.colors.danger } : {}),
    "--site-font-heading": FONT_STACKS[branding.typography.heading],
    "--site-font-body": FONT_STACKS[branding.typography.body],
    "--site-radius-sm": RADIUS_VALUES[branding.radius.small],
    "--site-radius-md": RADIUS_VALUES[branding.radius.medium],
    "--site-radius-lg": RADIUS_VALUES[branding.radius.large],
    "--site-section-spacing": SPACING_VALUES[branding.spacing.section],
  };
}

export interface ButtonVisualStyle {
  background: string;
  color: string;
  border: string;
}

export interface ButtonColorPair {
  /** The button's own color (background when solid, text/border otherwise). */
  base: string;
  /** The color used against `base` when the button is filled ("solid"). */
  foreground: string;
}

/**
 * Resolves a `buttons.primary`/`buttons.secondary` closed style mode
 * ("solid"/"outline"/"ghost" — never arbitrary CSS, section 6/18 of the
 * brief) into the actual background/color/border values a block renderer
 * applies to its `<a>`/`<button>` element. Centralized here so
 * `hero.tsx`/`cta.tsx` (and any future block) share one definition of what
 * each mode means, rather than each re-deriving its own.
 *
 * Deliberately takes the base/foreground colors as explicit parameters
 * rather than reading `branding.colors` directly: `cta.tsx`/`hero.tsx`
 * predate v0.8 and already draw their button color from the pre-existing
 * per-site `ThemeTokens` override (`t["color.primary"]`) — the platform's
 * original, still-live theming system (see docs/adr/0011-theme-token-model.md).
 * Reading `branding.colors.primary` here instead would silently discard
 * that override for every site that never configured the new v0.8
 * `SiteBranding` layer, a real non-regression break (section 25 of the
 * v0.8 brief). Only the button's *shape* (`buttons.primary.style`) is new
 * in v0.8; its *color* stays whatever the caller already resolves it to —
 * documented as a deliberate divergence in docs/adr/0021-site-theme-branding-design-system.md.
 */
export function resolveButtonStyle(
  colors: ButtonColorPair,
  style: ButtonStyleToken,
): ButtonVisualStyle {
  if (style === "solid") {
    return {
      background: colors.base,
      color: colors.foreground,
      border: `1px solid ${colors.base}`,
    };
  }
  if (style === "outline") {
    return { background: "transparent", color: colors.base, border: `1px solid ${colors.base}` };
  }
  // "ghost"
  return { background: "transparent", color: colors.base, border: "1px solid transparent" };
}

export interface SectionVisualStyle {
  background: string;
  border: string;
  boxShadow: string;
}

/**
 * Resolves `sections.style` ("flat"/"bordered"/"elevated") into the
 * background/border/shadow a section-shaped block (property cards,
 * grouped content) applies — the design-token-driven alternative to a
 * block hand-picking its own border/shadow values.
 */
export function resolveSectionStyle(branding: SiteBrandingV1): SectionVisualStyle {
  const style = branding.sections.style;
  if (style === "bordered") {
    return {
      background: branding.colors.surface,
      border: `1px solid ${branding.colors.border}`,
      boxShadow: "none",
    };
  }
  if (style === "elevated") {
    return {
      background: branding.colors.surface,
      border: "1px solid transparent",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
    };
  }
  // "flat"
  return {
    background: branding.colors.surface,
    border: "1px solid transparent",
    boxShadow: "none",
  };
}
