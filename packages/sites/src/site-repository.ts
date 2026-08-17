import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AppTx, SiteStatus } from "@provence360/database";
import { sites } from "@provence360/database";
import { navigationSchema, type Navigation } from "@provence360/content";
import { recordAuditLog } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import {
  parseSiteBrandingOverrides,
  themeOverridesSchema,
  type SiteBrandingOverrides,
  type ThemeOverrides,
} from "@provence360/themes";

export class SiteNotFoundError extends Error {
  constructor(siteId: string) {
    super(`Site "${siteId}" was not found (or does not belong to the current tenant).`);
    this.name = "SiteNotFoundError";
  }
}

// See packages/content/src/page-repository.ts's `eqUpdatedAtMs` for why
// this truncates to millisecond precision rather than a plain `eq()`:
// `sites.updated_at`'s first value comes from Postgres's own `now()`
// (microsecond precision) while every later value comes from JS's
// `new Date()` (millisecond precision only) — comparing a caller's
// (always millisecond-precision) `expectedUpdatedAt` against the raw
// column would spuriously mismatch whenever the first value's
// microseconds are non-zero.
function eqUpdatedAtMs(column: typeof sites.updatedAt, expected: Date): SQL {
  return sql`date_trunc('milliseconds', ${column}) = date_trunc('milliseconds', ${expected.toISOString()}::timestamptz)`;
}

/**
 * Thrown when a caller passed `expectedUpdatedAt` (an optimistic-concurrency
 * token — see `packages/content`'s `PageConflictError` for the same pattern
 * applied to Pages) and the Site's actual `updatedAt` no longer matches:
 * someone else's write already landed since the caller last read this Site.
 * Opt-in — every v0.3 call site that never passes `expectedUpdatedAt` keeps
 * its unconditional last-write-wins behavior.
 */
export class SiteConflictError extends Error {
  constructor(siteId: string) {
    super(`Site "${siteId}" was modified by someone else since it was last read.`);
    this.name = "SiteConflictError";
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
  /** Optimistic-concurrency token — see {@link SiteConflictError}. */
  expectedUpdatedAt?: Date;
}

export async function updateSiteSettings(tx: AppTx, input: UpdateSiteSettingsInput) {
  const tenantId = requireCurrentTenantId();
  const { id, actorUserId, expectedUpdatedAt, ...rest } = input;

  const [row] = await tx
    .update(sites)
    .set(rest)
    .where(
      expectedUpdatedAt
        ? and(
            eq(sites.id, id),
            eq(sites.tenantId, tenantId),
            eqUpdatedAtMs(sites.updatedAt, expectedUpdatedAt),
          )
        : and(eq(sites.id, id), eq(sites.tenantId, tenantId)),
    )
    .returning();
  if (!row) {
    if (expectedUpdatedAt) {
      const [stillExists] = await tx
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, id), eq(sites.tenantId, tenantId)));
      if (stillExists) throw new SiteConflictError(id);
    }
    throw new SiteNotFoundError(id);
  }

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

export interface UpdateSiteBrandingInput {
  id: string;
  /** Raw, tenant-authored overrides — validated here via `parseSiteBrandingOverrides` before ever reaching the database (v0.8, see docs/adr/0021-site-theme-branding-design-system.md). */
  branding: unknown;
  actorUserId?: string;
}

/**
 * Sets a Site's Draft branding overrides (v0.8) — the second, additive
 * customization layer on top of `updateSiteTheme`'s `themeOverrides`
 * above: brand identity, an expanded semantic color set, and closed
 * typography/radius/spacing/button/section tokens. Stores exactly the
 * overrides the tenant chose to set, never the fully-resolved object
 * (`resolveSiteBranding` does that at read/render time) — the same
 * "store the delta, resolve on read" shape `themeOverrides` already uses.
 * Never affects the public site until the next publish: this write only
 * ever touches the Draft `sites.branding` column, never a
 * `site_revisions` row.
 */
export async function updateSiteBranding(tx: AppTx, input: UpdateSiteBrandingInput) {
  const tenantId = requireCurrentTenantId();
  const branding: SiteBrandingOverrides = parseSiteBrandingOverrides(input.branding);

  const [row] = await tx
    .update(sites)
    .set({ branding })
    .where(and(eq(sites.id, input.id), eq(sites.tenantId, tenantId)))
    .returning();
  if (!row) throw new SiteNotFoundError(input.id);

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "SITE_BRANDING_UPDATED",
    targetType: "site",
    targetId: row.id,
    metadata: { overrideSections: Object.keys(branding) },
  });

  return row;
}

export interface UpdateSiteNavigationInput {
  id: string;
  /** Raw Draft-shaped input — validated here via `navigationSchema` before it ever reaches the database. */
  navigation: unknown;
  actorUserId?: string;
  /** Optimistic-concurrency token — see {@link SiteConflictError}. */
  expectedUpdatedAt?: Date;
}

/**
 * Sets a Site's Draft navigation (v0.5, section 5/12 of the brief). This is
 * *structural* validation only — `navigationSchema.parse` confirms the
 * shape (discriminated target kinds, valid UUIDs, bounded depth/item
 * count, unique ids) but cannot confirm a `{ kind: "page", pageId }`
 * target actually names a real Page of this Site: JSONB has no foreign
 * key, so that check is necessarily *referential*, not structural, and
 * belongs at publish time (`packages/publishing`'s `assembleDraft`), the
 * one place that already holds a consistent, single-transaction view of
 * both the navigation and the Pages it might reference — see
 * docs/PUBLISHING.md and section 12/13 of the v0.5 brief for why this
 * split (and not a second read here) is what keeps this safe under
 * concurrent edits.
 */
export async function updateSiteNavigation(tx: AppTx, input: UpdateSiteNavigationInput) {
  const tenantId = requireCurrentTenantId();
  const navigation: Navigation = navigationSchema.parse(input.navigation);

  const [row] = await tx
    .update(sites)
    .set({ navigation })
    .where(
      input.expectedUpdatedAt
        ? and(
            eq(sites.id, input.id),
            eq(sites.tenantId, tenantId),
            eqUpdatedAtMs(sites.updatedAt, input.expectedUpdatedAt),
          )
        : and(eq(sites.id, input.id), eq(sites.tenantId, tenantId)),
    )
    .returning();
  if (!row) {
    if (input.expectedUpdatedAt) {
      const [stillExists] = await tx
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, input.id), eq(sites.tenantId, tenantId)));
      if (stillExists) throw new SiteConflictError(input.id);
    }
    throw new SiteNotFoundError(input.id);
  }

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "SITE_NAVIGATION_UPDATED",
    targetType: "site",
    targetId: row.id,
    metadata: { itemCount: navigation.items.length },
  });

  return row;
}
