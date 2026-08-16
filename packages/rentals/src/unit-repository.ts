import { and, eq } from "drizzle-orm";
import type { AppTx, UnitSizeUnit, UnitStatus } from "@provence360/database";
import { properties, units } from "@provence360/database";
import { recordAuditLog } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import { PropertyNotFoundError, UnitNotFoundError } from "./errors";

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
}

export async function updateUnit(tx: AppTx, input: UpdateUnitInput) {
  const tenantId = requireCurrentTenantId();
  const { id, actorUserId, bathrooms, size, ...rest } = input;

  const [row] = await tx
    .update(units)
    .set({
      ...rest,
      ...(bathrooms !== undefined ? { bathrooms: String(bathrooms) } : {}),
      ...(size !== undefined ? { size: String(size) } : {}),
    })
    .where(and(eq(units.id, id), eq(units.tenantId, tenantId)))
    .returning();
  if (!row) throw new UnitNotFoundError(id);

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
