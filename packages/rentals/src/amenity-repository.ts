import { and, eq, inArray } from "drizzle-orm";
import type { AppTx } from "@provence360/database";
import {
  amenities,
  propertyAmenities,
  unitAmenities,
  properties,
  units,
} from "@provence360/database";
import { requireCurrentTenantId } from "@provence360/tenant";
import { PropertyNotFoundError, UnitNotFoundError } from "./errors";
import { amenityMetadataSchema, type AmenityMetadata } from "./validation";

/**
 * The full platform-level amenity catalog (see
 * `docs/adr/0012-media-asset-and-amenity-catalog.md`) — not tenant-scoped,
 * every tenant reads the same rows. Read-only: there is no
 * `createAmenity`/`updateAmenity` here, on purpose — the catalog is
 * curated by the admin/owner role (migrations/seed), not by tenant-facing
 * code, in v0.3.
 */
export async function listAmenities(tx: AppTx) {
  return tx.select().from(amenities).where(eq(amenities.status, "active"));
}

export async function listAmenitiesForUnit(tx: AppTx, unitId: string) {
  const tenantId = requireCurrentTenantId();
  return tx
    .select({
      amenityId: amenities.id,
      key: amenities.key,
      category: amenities.category,
      label: amenities.label,
      metadata: unitAmenities.metadata,
    })
    .from(unitAmenities)
    .innerJoin(amenities, eq(amenities.id, unitAmenities.amenityId))
    .where(and(eq(unitAmenities.unitId, unitId), eq(unitAmenities.tenantId, tenantId)));
}

/**
 * v0.6: the same catalog join, one level up (section 11 of the brief —
 * Amenities were Unit-only; a Property itself can now have its own, e.g. a
 * shared pool or on-site parking, distinct from any one Unit's amenities).
 */
export async function listAmenitiesForProperty(tx: AppTx, propertyId: string) {
  const tenantId = requireCurrentTenantId();
  return tx
    .select({
      amenityId: amenities.id,
      key: amenities.key,
      category: amenities.category,
      label: amenities.label,
      metadata: propertyAmenities.metadata,
    })
    .from(propertyAmenities)
    .innerJoin(amenities, eq(amenities.id, propertyAmenities.amenityId))
    .where(
      and(eq(propertyAmenities.propertyId, propertyId), eq(propertyAmenities.tenantId, tenantId)),
    );
}

export interface AmenityAttachmentInput {
  amenityId: string;
  /** Validated against {@link amenityMetadataSchema} before it ever reaches the database — see that schema's own doc comment. */
  metadata?: AmenityMetadata;
}

function normalizeAttachments(
  entries: readonly (string | AmenityAttachmentInput)[],
): { amenityId: string; metadata: AmenityMetadata }[] {
  return entries.map((entry) =>
    typeof entry === "string"
      ? { amenityId: entry, metadata: {} }
      : { amenityId: entry.amenityId, metadata: amenityMetadataSchema.parse(entry.metadata ?? {}) },
  );
}

/**
 * Replaces the full set of amenities attached to a Unit the current tenant
 * owns with exactly `amenities` — a simple, idempotent "this is now the
 * complete list" operation rather than incremental add/remove calls a
 * caller would need to sequence correctly. Accepts either a bare amenity
 * id (pre-v0.6 shape, metadata defaults to `{}`) or `{ amenityId, metadata }`
 * (v0.6) — backward compatible with every existing caller. The Unit
 * ownership check is the same pattern as `createUnit`/`createProperty`;
 * `amenity_id` itself needs no tenant check (the catalog isn't tenant
 * data — see `docs/adr/0012-media-asset-and-amenity-catalog.md`), and any
 * id that isn't a real catalog row is simply rejected by the
 * `unit_amenities_amenity_id_amenities_id_fk` foreign key.
 */
export async function setUnitAmenities(
  tx: AppTx,
  unitId: string,
  amenityEntries: readonly (string | AmenityAttachmentInput)[],
): Promise<void> {
  const tenantId = requireCurrentTenantId();

  const [unit] = await tx
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.tenantId, tenantId)));
  if (!unit) throw new UnitNotFoundError(unitId);

  const normalized = normalizeAttachments(amenityEntries);

  await tx.delete(unitAmenities).where(eq(unitAmenities.unitId, unitId));

  if (normalized.length === 0) return;

  await tx.insert(unitAmenities).values(
    normalized.map(({ amenityId, metadata }) => ({
      tenantId,
      unitId,
      amenityId,
      metadata,
    })),
  );
}

/** Same "replace the whole set" shape as {@link setUnitAmenities}, one level up (v0.6, section 11). */
export async function setPropertyAmenities(
  tx: AppTx,
  propertyId: string,
  amenityEntries: readonly (string | AmenityAttachmentInput)[],
): Promise<void> {
  const tenantId = requireCurrentTenantId();

  const [property] = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.tenantId, tenantId)));
  if (!property) throw new PropertyNotFoundError(propertyId);

  const normalized = normalizeAttachments(amenityEntries);

  await tx.delete(propertyAmenities).where(eq(propertyAmenities.propertyId, propertyId));

  if (normalized.length === 0) return;

  await tx.insert(propertyAmenities).values(
    normalized.map(({ amenityId, metadata }) => ({
      tenantId,
      propertyId,
      amenityId,
      metadata,
    })),
  );
}

// Re-exported for callers that need to validate a submitted amenity id
// list against the real catalog before calling setUnitAmenities (e.g. to
// render a clean validation error instead of a raw FK-violation).
export async function amenitiesExist(tx: AppTx, amenityIds: readonly string[]): Promise<boolean> {
  if (amenityIds.length === 0) return true;
  const rows = await tx
    .select({ id: amenities.id })
    .from(amenities)
    .where(inArray(amenities.id, [...amenityIds]));
  return rows.length === amenityIds.length;
}
