"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { updateSiteSettings, updateSiteTheme } from "@provence360/sites";
import { withTenantPage } from "@/lib/actor";

export interface FormActionState {
  error?: string;
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
