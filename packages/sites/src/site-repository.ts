import { and, eq } from "drizzle-orm";
import type { AppTx, SiteStatus } from "@provence360/database";
import { sites } from "@provence360/database";
import { recordAuditLog } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import { themeOverridesSchema, type ThemeOverrides } from "@provence360/themes";

export class SiteNotFoundError extends Error {
  constructor(siteId: string) {
    super(`Site "${siteId}" was not found (or does not belong to the current tenant).`);
    this.name = "SiteNotFoundError";
  }
}

/**
 * Creates a site owned by the current tenant. `tenantId` is always derived
 * from the active `withTenantContext()` call (never accepted as an
 * argument) so a caller cannot forge it — and even if this function had a
 * bug and forgot to set it correctly, the `tenant_isolation_sites` RLS
 * policy's `withCheck` clause would still reject a row whose `tenant_id`
 * doesn't match the transaction's `app.tenant_id`. Two independent layers,
 * either one alone would have stopped this.
 *
 * `actorUserId` is optional (v0.1 callers — tests, the seed script — have
 * no authenticated actor) but every v0.2 call site reached through
 * `withAuthorizedTenantContext` has one and should pass it, so the
 * resulting SITE_CREATED audit entry is attributable.
 */
export async function createSite(
  tx: AppTx,
  input: { slug: string; name: string; status?: SiteStatus; actorUserId?: string },
) {
  const tenantId = requireCurrentTenantId();

  const [row] = await tx
    .insert(sites)
    .values({
      tenantId,
      slug: input.slug,
      name: input.name,
      status: input.status ?? "draft",
    })
    .returning();
  if (!row) throw new Error("Failed to create site");

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "SITE_CREATED",
    targetType: "site",
    targetId: row.id,
    metadata: { slug: row.slug, name: row.name },
  });

  return row;
}

export async function getSiteBySlug(tx: AppTx, slug: string) {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .select()
    .from(sites)
    .where(and(eq(sites.slug, slug), eq(sites.tenantId, tenantId)));
  return row ?? null;
}

export async function listSites(tx: AppTx) {
  const tenantId = requireCurrentTenantId();
  return tx.select().from(sites).where(eq(sites.tenantId, tenantId));
}

export async function getSite(tx: AppTx, id: string) {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.tenantId, tenantId)));
  return row ?? null;
}

export interface UpdateSiteSettingsInput {
  id: string;
  publicName?: string;
  timezone?: string;
  defaultLocale?: string;
  enabledLocales?: readonly string[];
  contactEmail?: string;
  contactPhone?: string;
  actorUserId?: string;
}

export async function updateSiteSettings(tx: AppTx, input: UpdateSiteSettingsInput) {
  const tenantId = requireCurrentTenantId();
  const { id, actorUserId, ...rest } = input;

  const [row] = await tx
    .update(sites)
    .set(rest)
    .where(and(eq(sites.id, id), eq(sites.tenantId, tenantId)))
    .returning();
  if (!row) throw new SiteNotFoundError(id);

  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: "SITE_UPDATED",
    targetType: "site",
    targetId: row.id,
    metadata: { slug: row.slug },
  });

  return row;
}

export interface UpdateSiteThemeInput {
  id: string;
  themeId?: string | null;
  themeOverrides?: ThemeOverrides;
  actorUserId?: string;
}

/**
 * Sets a Site's base Theme and/or its narrow token overrides
 * (docs/adr/0011-theme-token-model.md). `themeOverrides` is re-validated
 * against the closed token schema here — never trusted as already-clean
 * just because a caller claims it is. `themeId: null` clears the theme
 * back to "none" (the renderer's hard-coded fallback tokens apply).
 * Records two distinct audit actions, matching which of the two actually
 * changed, so a THEME_CHANGED entry always means "the base theme itself
 * changed," not "some override somewhere changed."
 */
export async function updateSiteTheme(tx: AppTx, input: UpdateSiteThemeInput) {
  const tenantId = requireCurrentTenantId();

  const overrides =
    input.themeOverrides !== undefined
      ? themeOverridesSchema.parse(input.themeOverrides)
      : undefined;

  const [row] = await tx
    .update(sites)
    .set({
      ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
      ...(overrides !== undefined ? { themeOverrides: overrides } : {}),
    })
    .where(and(eq(sites.id, input.id), eq(sites.tenantId, tenantId)))
    .returning();
  if (!row) throw new SiteNotFoundError(input.id);

  if (input.themeId !== undefined) {
    await recordAuditLog(tx, {
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      action: "THEME_CHANGED",
      targetType: "site",
      targetId: row.id,
      metadata: { themeId: input.themeId },
    });
  }
  if (overrides !== undefined) {
    await recordAuditLog(tx, {
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      action: "THEME_OVERRIDES_CHANGED",
      targetType: "site",
      targetId: row.id,
      metadata: { overrideKeys: Object.keys(overrides) },
    });
  }

  return row;
}
