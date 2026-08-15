import { and, eq } from "drizzle-orm";
import type { AppTx, PropertyStatus, PropertyType } from "@provence360/database";
import { properties, sites } from "@provence360/database";
import { recordAuditLog } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import { PropertyNotFoundError, SiteNotFoundError } from "./errors";

export interface CreatePropertyInput {
  siteId: string;
  internalName: string;
  publicName: string;
  slug: string;
  description?: string;
  propertyType: PropertyType;
  addressLine1?: string;
  addressLine2?: string;
  addressCity?: string;
  addressPostalCode?: string;
  addressRegion?: string;
  addressCountry?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  status?: PropertyStatus;
  actorUserId?: string;
}

/**
 * Creates a Property owned by the current tenant, attached to a Site the
 * current tenant also owns. The site lookup is scoped to the active
 * `withTenantContext()` transaction, so attaching to another tenant's site
 * simply finds nothing (RLS already filtered it out) and fails with
 * `SiteNotFoundError` — the same pattern as `packages/domains`'
 * `createDomain`. The composite foreign key `properties_tenant_site_fk`
 * (see `docs/adr/0010-property-unit-ownership.md`) is the second,
 * database-level layer behind this: even if this check were ever removed
 * or buggy, Postgres itself would refuse a row whose `tenant_id` doesn't
 * match its `site_id`'s owner.
 */
export async function createProperty(tx: AppTx, input: CreatePropertyInput) {
  const tenantId = requireCurrentTenantId();

  const [site] = await tx
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, tenantId)));
  if (!site) throw new SiteNotFoundError(input.siteId);

  const [row] = await tx
    .insert(properties)
    .values({
      tenantId,
      siteId: site.id,
      internalName: input.internalName,
      publicName: input.publicName,
      slug: input.slug,
      description: input.description,
      propertyType: input.propertyType,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      addressCity: input.addressCity,
      addressPostalCode: input.addressPostalCode,
      addressRegion: input.addressRegion,
      addressCountry: input.addressCountry,
      ...(input.latitude !== undefined ? { latitude: String(input.latitude) } : {}),
      ...(input.longitude !== undefined ? { longitude: String(input.longitude) } : {}),
      timezone: input.timezone,
      status: input.status ?? "draft",
    })
    .returning();
  if (!row) throw new Error("Failed to create property");

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "PROPERTY_CREATED",
    targetType: "property",
    targetId: row.id,
    metadata: { slug: row.slug, siteId: row.siteId },
  });

  return row;
}

export interface UpdatePropertyInput {
  id: string;
  internalName?: string;
  publicName?: string;
  description?: string;
  propertyType?: PropertyType;
  addressLine1?: string;
  addressLine2?: string;
  addressCity?: string;
  addressPostalCode?: string;
  addressRegion?: string;
  addressCountry?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  status?: PropertyStatus;
  actorUserId?: string;
}

export async function updateProperty(tx: AppTx, input: UpdatePropertyInput) {
  const tenantId = requireCurrentTenantId();
  const { id, actorUserId, latitude, longitude, ...rest } = input;

  const [row] = await tx
    .update(properties)
    .set({
      ...rest,
      ...(latitude !== undefined ? { latitude: String(latitude) } : {}),
      ...(longitude !== undefined ? { longitude: String(longitude) } : {}),
    })
    .where(and(eq(properties.id, id), eq(properties.tenantId, tenantId)))
    .returning();
  if (!row) throw new PropertyNotFoundError(id);

  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: "PROPERTY_UPDATED",
    targetType: "property",
    targetId: row.id,
    metadata: { slug: row.slug },
  });

  return row;
}

export async function deleteProperty(tx: AppTx, id: string, actorUserId?: string): Promise<void> {
  const tenantId = requireCurrentTenantId();

  const [row] = await tx
    .delete(properties)
    .where(and(eq(properties.id, id), eq(properties.tenantId, tenantId)))
    .returning();
  if (!row) throw new PropertyNotFoundError(id);

  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: "PROPERTY_DELETED",
    targetType: "property",
    targetId: row.id,
    metadata: { slug: row.slug },
  });
}

export async function getProperty(tx: AppTx, id: string) {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .select()
    .from(properties)
    .where(and(eq(properties.id, id), eq(properties.tenantId, tenantId)));
  return row ?? null;
}

export async function listPropertiesForSite(tx: AppTx, siteId: string) {
  const tenantId = requireCurrentTenantId();
  return tx
    .select()
    .from(properties)
    .where(and(eq(properties.siteId, siteId), eq(properties.tenantId, tenantId)));
}
