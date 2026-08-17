"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { updateSiteBranding, updateSiteSettings, updateSiteTheme } from "@provence360/sites";
import {
  BUTTON_STYLE_TOKENS,
  FONT_TOKENS,
  RADIUS_TOKENS,
  SECTION_STYLE_TOKENS,
  SPACING_TOKENS,
  resolveContrastWarnings,
  resolveSiteBranding,
  type ContrastWarning,
} from "@provence360/themes";
import { hexColorSchema, uuidSchema } from "@provence360/validation";
import { withTenantPage } from "@/lib/actor";

export interface FormActionState {
  error?: string;
}

export interface BrandingFormActionState extends FormActionState {
  warnings?: ContrastWarning[];
}

const updateSettingsSchema = z.object({
  publicName: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  defaultLocale: z.string().trim().min(2).max(10).optional(),
  enabledLocales: z
    .string()
    .trim()
    .transform((value) =>
      value
        .split(",")
        .map((locale) => locale.trim())
        .filter(Boolean),
    )
    .optional(),
  contactEmail: z.string().trim().email().optional().or(z.literal("")),
});

export async function updateSiteSettingsAction(
  tenantId: string,
  siteId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const raw = {
    publicName: formData.get("publicName")?.toString() || undefined,
    timezone: formData.get("timezone")?.toString() || undefined,
    defaultLocale: formData.get("defaultLocale")?.toString() || undefined,
    enabledLocales: formData.get("enabledLocales")?.toString() || undefined,
    contactEmail: formData.get("contactEmail")?.toString() ?? "",
  };
  const parsed = updateSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await withTenantPage(tenantId, "site.update", (tx, actor) =>
      updateSiteSettings(tx, {
        id: siteId,
        ...(parsed.data.publicName !== undefined ? { publicName: parsed.data.publicName } : {}),
        ...(parsed.data.timezone !== undefined ? { timezone: parsed.data.timezone } : {}),
        ...(parsed.data.defaultLocale !== undefined
          ? { defaultLocale: parsed.data.defaultLocale }
          : {}),
        ...(parsed.data.enabledLocales !== undefined
          ? { enabledLocales: parsed.data.enabledLocales }
          : {}),
        ...(parsed.data.contactEmail ? { contactEmail: parsed.data.contactEmail } : {}),
        actorUserId: actor.userId,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "SiteNotFoundError")
      return { error: "Site not found." };
    throw error;
  }

  revalidatePath(`/admin/tenants/${tenantId}/sites/${siteId}`);
  return {};
}

const updateThemeSchema = z.object({
  themeId: z.string().trim().uuid().optional().or(z.literal("")),
  themeOverrides: z.string().trim().optional(),
});

export async function updateSiteThemeAction(
  tenantId: string,
  siteId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = updateThemeSchema.safeParse({
    themeId: formData.get("themeId")?.toString() ?? "",
    themeOverrides: formData.get("themeOverrides")?.toString() ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  let overrides: Record<string, string> | undefined;
  if (parsed.data.themeOverrides) {
    try {
      overrides = JSON.parse(parsed.data.themeOverrides) as Record<string, string>;
    } catch {
      return { error: 'Theme overrides must be valid JSON, e.g. {"color.primary": "#123456"}.' };
    }
  }

  try {
    await withTenantPage(tenantId, "theme.update", (tx, actor) =>
      updateSiteTheme(tx, {
        id: siteId,
        ...(parsed.data.themeId ? { themeId: parsed.data.themeId } : {}),
        ...(overrides !== undefined ? { themeOverrides: overrides } : {}),
        actorUserId: actor.userId,
      }),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "SiteNotFoundError" || error.name.startsWith("Zod"))
    ) {
      return { error: error.message };
    }
    if (error instanceof Error && /issues|invalid/i.test(error.message)) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/admin/tenants/${tenantId}/sites/${siteId}`);
  return {};
}

// v0.8 — Site Theme, Branding & Design System Kernel (see
// docs/adr/0021-site-theme-branding-design-system.md). A structured form
// (not a raw-JSON textarea like `updateThemeSchema` above) — every field
// is a specific, closed-shape input (a hex color, a `<select>` from a
// closed enum, an existing MediaAsset id) so there is no way for this
// form to submit anything `siteBrandingOverridesV1Schema` wouldn't already
// accept from a hand-crafted request. The optional `blank = unset` colors
// (`success`/`warning`/`danger`) accept an empty string, which the schema
// below treats as "not provided," not as an invalid hex value.
const optionalHex = z.union([hexColorSchema, z.literal("")]);
const optionalMediaId = z.union([uuidSchema, z.literal("")]);

const updateBrandingSchema = z.object({
  brandName: z.string().trim().max(120).optional().or(z.literal("")),
  logoMediaId: optionalMediaId,
  logoDarkMediaId: optionalMediaId,
  faviconMediaId: optionalMediaId,
  colorBackground: hexColorSchema,
  colorSurface: hexColorSchema,
  colorSurfaceMuted: hexColorSchema,
  colorText: hexColorSchema,
  colorTextMuted: hexColorSchema,
  colorPrimary: hexColorSchema,
  colorPrimaryForeground: hexColorSchema,
  colorSecondary: hexColorSchema,
  colorSecondaryForeground: hexColorSchema,
  colorAccent: hexColorSchema,
  colorAccentForeground: hexColorSchema,
  colorBorder: hexColorSchema,
  colorSuccess: optionalHex,
  colorWarning: optionalHex,
  colorDanger: optionalHex,
  typographyHeading: z.enum(FONT_TOKENS),
  typographyBody: z.enum(FONT_TOKENS),
  radiusSmall: z.enum(RADIUS_TOKENS),
  radiusMedium: z.enum(RADIUS_TOKENS),
  radiusLarge: z.enum(RADIUS_TOKENS),
  spacingSection: z.enum(SPACING_TOKENS),
  buttonsPrimaryStyle: z.enum(BUTTON_STYLE_TOKENS),
  buttonsSecondaryStyle: z.enum(BUTTON_STYLE_TOKENS),
  sectionsStyle: z.enum(SECTION_STYLE_TOKENS),
});

export async function updateSiteBrandingAction(
  tenantId: string,
  siteId: string,
  _prevState: BrandingFormActionState,
  formData: FormData,
): Promise<BrandingFormActionState> {
  const raw = Object.fromEntries(
    Object.keys(updateBrandingSchema.shape).map((key) => [
      key,
      formData.get(key)?.toString() ?? "",
    ]),
  );
  const parsed = updateBrandingSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const v = parsed.data;

  const overrides = {
    version: 1 as const,
    brand: {
      ...(v.brandName ? { name: v.brandName } : {}),
      ...(v.logoMediaId ? { logo: { mediaId: v.logoMediaId } } : {}),
      ...(v.logoDarkMediaId ? { logoDark: { mediaId: v.logoDarkMediaId } } : {}),
      ...(v.faviconMediaId ? { favicon: { mediaId: v.faviconMediaId } } : {}),
    },
    colors: {
      background: v.colorBackground,
      surface: v.colorSurface,
      surfaceMuted: v.colorSurfaceMuted,
      text: v.colorText,
      textMuted: v.colorTextMuted,
      primary: v.colorPrimary,
      primaryForeground: v.colorPrimaryForeground,
      secondary: v.colorSecondary,
      secondaryForeground: v.colorSecondaryForeground,
      accent: v.colorAccent,
      accentForeground: v.colorAccentForeground,
      border: v.colorBorder,
      ...(v.colorSuccess ? { success: v.colorSuccess } : {}),
      ...(v.colorWarning ? { warning: v.colorWarning } : {}),
      ...(v.colorDanger ? { danger: v.colorDanger } : {}),
    },
    typography: { heading: v.typographyHeading, body: v.typographyBody },
    radius: { small: v.radiusSmall, medium: v.radiusMedium, large: v.radiusLarge },
    spacing: { section: v.spacingSection },
    buttons: {
      primary: { style: v.buttonsPrimaryStyle },
      secondary: { style: v.buttonsSecondaryStyle },
    },
    sections: { style: v.sectionsStyle },
  };

  try {
    await withTenantPage(tenantId, "theme.update", (tx, actor) =>
      updateSiteBranding(tx, { id: siteId, branding: overrides, actorUserId: actor.userId }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "SiteNotFoundError") {
      return { error: "Site not found." };
    }
    if (error instanceof Error && /issues|invalid|hex|must be/i.test(error.message)) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/admin/tenants/${tenantId}/sites/${siteId}`);

  // Section 17 of the brief: a non-blocking, informational warning — the
  // save above already succeeded and the tenant's colors were stored
  // exactly as chosen, never silently adjusted.
  const warnings = resolveContrastWarnings(resolveSiteBranding(overrides));
  return warnings.length > 0 ? { warnings } : {};
}
