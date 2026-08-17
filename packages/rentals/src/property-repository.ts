import { and, eq, sql, type SQL } from "drizzle-orm";
import type {
  AppTx,
  LocationDisclosure,
  PropertyStatus,
  PropertyType,
  RentalPolicy,
} from "@provence360/database";
import { properties, sites } from "@provence360/database";
import { recordAuditLog } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import { PropertyConflictError, PropertyNotFoundError, SiteNotFoundError } from "./errors";

// See packages/sites/src/site-repository.ts's `eqUpdatedAtMs` for why this
// truncates to millisecond precision rather than a plain `eq()`.
function eqUpdatedAtMs(column: typeof properties.updatedAt, expected: Date): SQL {
  return sql`date_trunc('milliseconds', ${column}) = date_trunc('milliseconds', ${expected.toISOString()}::timestamptz)`;
}

/**
 * A Property that is not `"active"` is never shown on the public site
 * (section 13 of the v0.6 brief) — draft Properties an owner is still
 * editing, and archived ones an owner has retired, are real rows that stay
 * fully readable/editable in the admin UI, just never rendered publicly,
 * even by an old published Revision that still references them (the
 * Revision's *presentation* stays frozen; the Rental data it points at is
 * always read live — see docs/SITE_DOMAIN.md#future-release-compatibility
 * and docs/adr/0018-rental-domain-guest-experience.md).
 */
export function isPublicPropertyStatus(status: PropertyStatus): boolean {
  return status === "active";
}

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
  checkInTime?: string;
  checkOutTime?: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  smokingPolicy?: RentalPolicy;
  petsPolicy?: RentalPolicy;
  eventsPolicy?: RentalPolicy;
  locationDisclosure?: LocationDisclosure;
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
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      quietHoursStart: input.quietHoursStart,
      quietHoursEnd: input.quietHoursEnd,
      smokingPolicy: input.smokingPolicy,
      petsPolicy: input.petsPolicy,
      eventsPolicy: input.eventsPolicy,
      ...(input.locationDisclosure !== undefined
        ? { locationDisclosure: input.locationDisclosure }
        : {}),
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
  checkInTime?: string;
  checkOutTime?: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  smokingPolicy?: RentalPolicy;
  petsPolicy?: RentalPolicy;
  eventsPolicy?: RentalPolicy;
  locationDisclosure?: LocationDisclosure;
  actorUserId?: string;
  /** Optimistic-concurrency token (v0.6) — see {@link PropertyConflictError}. Opt-in: omitted, every pre-v0.6 caller keeps its unconditional last-write-wins behavior. */
  expectedUpdatedAt?: Date;
}

export async function updateProperty(tx: AppTx, input: UpdatePropertyInput) {
  const tenantId = requireCurrentTenantId();
  const { id, actorUserId, latitude, longitude, expectedUpdatedAt, ...rest } = input;

  const [row] = await tx
    .update(properties)
    .set({
      ...rest,
      ...(latitude !== undefined ? { latitude: String(latitude) } : {}),
      ...(longitude !== undefined ? { longitude: String(longitude) } : {}),
    })
    .where(
      expectedUpdatedAt
        ? and(
            eq(properties.id, id),
            eq(properties.tenantId, tenantId),
            eqUpdatedAtMs(properties.updatedAt, expectedUpdatedAt),
          )
        : and(eq(properties.id, id), eq(properties.tenantId, tenantId)),
    )
    .returning();
  if (!row) {
    if (expectedUpdatedAt) {
      const [stillExists] = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.id, id), eq(properties.tenantId, tenantId)));
      if (stillExists) throw new PropertyConflictError(id);
    }
    throw new PropertyNotFoundError(id);
  }

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

/**
 * Same lookup as `getProperty`, additionally gated on
 * {@link isPublicPropertyStatus} — the one function every public-facing
 * caller (the renderer, publish-time domain reference validation) should
 * use instead of `getProperty`, so "is this Property allowed to be shown
 * publicly" is answered in exactly one place rather than re-implemented
 * per call site (section 14 of the v0.6 brief).
 */
export async function getPublicProperty(tx: AppTx, id: string) {
  const row = await getProperty(tx, id);
  return row && isPublicPropertyStatus(row.status) ? row : null;
}

export async function listPropertiesForSite(tx: AppTx, siteId: string) {
  const tenantId = requireCurrentTenantId();
  return tx
    .select()
    .from(properties)
    .where(and(eq(properties.siteId, siteId), eq(properties.tenantId, tenantId)));
}
