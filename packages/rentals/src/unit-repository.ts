import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AppTx, UnitSizeUnit, UnitStatus } from "@provence360/database";
import { properties, units } from "@provence360/database";
import { recordAuditLog } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import { PropertyNotFoundError, UnitConflictError, UnitNotFoundError } from "./errors";

// See packages/sites/src/site-repository.ts's `eqUpdatedAtMs` for why this
// truncates to millisecond precision rather than a plain `eq()`.
function eqUpdatedAtMs(column: typeof units.updatedAt, expected: Date): SQL {
  return sql`date_trunc('milliseconds', ${column}) = date_trunc('milliseconds', ${expected.toISOString()}::timestamptz)`;
}

/**
 * A Unit is shown on the public site when it is `"active"` or
 * `"not_bookable_separately"` (a Unit that's real and presentable but only
 * as part of its Property, e.g. a room within a whole-villa listing) —
 * this is the exact predicate `unit-grid.tsx` already applied inline
 * pre-v0.6; it now lives here as the one place every public-facing caller
 * (renderer, publish-time validation) should read it from. `"draft"`/
 * `"archived"` Units are never public. See section 13 of the v0.6 brief.
 */
export function isPublicUnitStatus(status: UnitStatus): boolean {
  return status === "active" || status === "not_bookable_separately";
}

export interface CreateUnitInput {
  propertyId: string;
  internalName: string;
  publicName: string;
  slug: string;
  status?: UnitStatus;
  maxGuests?: number;
  bedrooms?: number;
  beds?: number;
  bathrooms?: number;
  size?: number;
  sizeUnit?: UnitSizeUnit;
  description?: string;
  ordering?: number;
  actorUserId?: string;
}

/**
 * Creates a Unit owned by the current tenant, attached to a Property the
 * current tenant also owns — same ownership-check-then-composite-FK
 * pattern as `createProperty`. See `docs/adr/0010-property-unit-ownership.md`.
 */
export async function createUnit(tx: AppTx, input: CreateUnitInput) {
  const tenantId = requireCurrentTenantId();

  const [property] = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, input.propertyId), eq(properties.tenantId, tenantId)));
  if (!property) throw new PropertyNotFoundError(input.propertyId);

  const [row] = await tx
    .insert(units)
    .values({
      tenantId,
      propertyId: property.id,
      internalName: input.internalName,
      publicName: input.publicName,
      slug: input.slug,
      status: input.status ?? "draft",
      maxGuests: input.maxGuests,
      bedrooms: input.bedrooms,
      beds: input.beds,
      ...(input.bathrooms !== undefined ? { bathrooms: String(input.bathrooms) } : {}),
      ...(input.size !== undefined ? { size: String(input.size) } : {}),
      sizeUnit: input.sizeUnit,
      description: input.description,
      ordering: input.ordering ?? 0,
    })
    .returning();
  if (!row) throw new Error("Failed to create unit");

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "UNIT_CREATED",
    targetType: "unit",
    targetId: row.id,
    metadata: { slug: row.slug, propertyId: row.propertyId },
  });

  return row;
}

export interface UpdateUnitInput {
  id: string;
  internalName?: string;
  publicName?: string;
  status?: UnitStatus;
  maxGuests?: number;
  bedrooms?: number;
  beds?: number;
  bathrooms?: number;
  size?: number;
  sizeUnit?: UnitSizeUnit;
  description?: string;
  ordering?: number;
  actorUserId?: string;
  /** Optimistic-concurrency token (v0.6) — see {@link UnitConflictError}. Opt-in: omitted, every pre-v0.6 caller keeps its unconditional last-write-wins behavior. */
  expectedUpdatedAt?: Date;
}

export async function updateUnit(tx: AppTx, input: UpdateUnitInput) {
  const tenantId = requireCurrentTenantId();
  const { id, actorUserId, bathrooms, size, expectedUpdatedAt, ...rest } = input;

  const [row] = await tx
    .update(units)
    .set({
      ...rest,
      ...(bathrooms !== undefined ? { bathrooms: String(bathrooms) } : {}),
      ...(size !== undefined ? { size: String(size) } : {}),
    })
    .where(
      expectedUpdatedAt
        ? and(
            eq(units.id, id),
            eq(units.tenantId, tenantId),
            eqUpdatedAtMs(units.updatedAt, expectedUpdatedAt),
          )
        : and(eq(units.id, id), eq(units.tenantId, tenantId)),
    )
    .returning();
  if (!row) {
    if (expectedUpdatedAt) {
      const [stillExists] = await tx
        .select({ id: units.id })
        .from(units)
        .where(and(eq(units.id, id), eq(units.tenantId, tenantId)));
      if (stillExists) throw new UnitConflictError(id);
    }
    throw new UnitNotFoundError(id);
  }

  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: "UNIT_UPDATED",
    targetType: "unit",
    targetId: row.id,
    metadata: { slug: row.slug },
  });

  return row;
}

export async function deleteUnit(tx: AppTx, id: string, actorUserId?: string): Promise<void> {
  const tenantId = requireCurrentTenantId();

  const [row] = await tx
    .delete(units)
    .where(and(eq(units.id, id), eq(units.tenantId, tenantId)))
    .returning();
  if (!row) throw new UnitNotFoundError(id);

  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: "UNIT_DELETED",
    targetType: "unit",
    targetId: row.id,
    metadata: { slug: row.slug },
  });
}

export async function getUnit(tx: AppTx, id: string) {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .select()
    .from(units)
    .where(and(eq(units.id, id), eq(units.tenantId, tenantId)));
  return row ?? null;
}

export async function listUnitsForProperty(tx: AppTx, propertyId: string) {
  const tenantId = requireCurrentTenantId();
  return tx
    .select()
    .from(units)
    .where(and(eq(units.propertyId, propertyId), eq(units.tenantId, tenantId)))
    .orderBy(units.ordering);
}

/** Same lookup as `getUnit`, additionally gated on {@link isPublicUnitStatus} — see `getPublicProperty`'s doc comment for why this exists as a named function. */
export async function getPublicUnit(tx: AppTx, id: string) {
  const row = await getUnit(tx, id);
  return row && isPublicUnitStatus(row.status) ? row : null;
}

/** Same query as `listUnitsForProperty`, filtered to {@link isPublicUnitStatus} — the renderer's `unit-grid` block now calls this instead of filtering inline. */
export async function listPublicUnitsForProperty(tx: AppTx, propertyId: string) {
  const rows = await listUnitsForProperty(tx, propertyId);
  return rows.filter((unit) => isPublicUnitStatus(unit.status));
}
