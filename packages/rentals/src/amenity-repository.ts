import { and, eq, inArray } from "drizzle-orm";
import type { AppTx } from "@provence360/database";
import { amenities, unitAmenities, units } from "@provence360/database";
import { requireCurrentTenantId } from "@provence360/tenant";
import { UnitNotFoundError } from "./errors";

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
 * Replaces the full set of amenities attached to a Unit the current tenant
 * owns with exactly `amenityIds` — a simple, idempotent "this is now the
 * complete list" operation rather than incremental add/remove calls a
 * caller would need to sequence correctly. The Unit ownership check is the
 * same pattern as `createUnit`/`createProperty`; `amenity_id` itself needs
 * no tenant check (the catalog isn't tenant data — see
 * `docs/adr/0012-media-asset-and-amenity-catalog.md`), and any id that
 * isn't a real catalog row is simply rejected by the
 * `unit_amenities_amenity_id_amenities_id_fk` foreign key.
 */
export async function setUnitAmenities(
  tx: AppTx,
  unitId: string,
  amenityIds: readonly string[],
): Promise<void> {
  const tenantId = requireCurrentTenantId();

  const [unit] = await tx
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.tenantId, tenantId)));
  if (!unit) throw new UnitNotFoundError(unitId);

  await tx.delete(unitAmenities).where(eq(unitAmenities.unitId, unitId));

  if (amenityIds.length === 0) return;

  await tx.insert(unitAmenities).values(
    amenityIds.map((amenityId) => ({
      tenantId,
      unitId,
      amenityId,
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
