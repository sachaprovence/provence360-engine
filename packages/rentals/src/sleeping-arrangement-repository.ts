import { and, eq } from "drizzle-orm";
import type { AppTx, BedType } from "@provence360/database";
import { unitSleepingArrangements, units } from "@provence360/database";
import { recordAuditLog } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import { SleepingArrangementNotFoundError, UnitNotFoundError } from "./errors";

async function assertUnitOwnership(tx: AppTx, unitId: string, tenantId: string): Promise<void> {
  const [unit] = await tx
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.tenantId, tenantId)));
  if (!unit) throw new UnitNotFoundError(unitId);
}

export interface CreateSleepingArrangementInput {
  unitId: string;
  roomLabel?: string;
  bedType: BedType;
  quantity?: number;
  ordering?: number;
  actorUserId?: string;
}

/**
 * Adds one sleeping-space row to a Unit the current tenant owns — a real
 * per-row create, not a bulk replace, since section 10 of the v0.6 brief
 * requires individual create/update/delete (unlike `setUnitAmenities`'s
 * intentional "replace the whole set" shape, which fits a small, unordered
 * catalog attachment much better than an ordered, individually-editable
 * list of rooms/beds does).
 */
export async function createSleepingArrangement(tx: AppTx, input: CreateSleepingArrangementInput) {
  const tenantId = requireCurrentTenantId();
  await assertUnitOwnership(tx, input.unitId, tenantId);

  const [row] = await tx
    .insert(unitSleepingArrangements)
    .values({
      tenantId,
      unitId: input.unitId,
      roomLabel: input.roomLabel,
      bedType: input.bedType,
      quantity: input.quantity ?? 1,
      ordering: input.ordering ?? 0,
    })
    .returning();
  if (!row) throw new Error("Failed to create sleeping arrangement");

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "SLEEPING_ARRANGEMENT_CREATED",
    targetType: "unit_sleeping_arrangement",
    targetId: row.id,
    metadata: { unitId: row.unitId, bedType: row.bedType, quantity: row.quantity },
  });

  return row;
}

export interface UpdateSleepingArrangementInput {
  id: string;
  roomLabel?: string;
  bedType?: BedType;
  quantity?: number;
  ordering?: number;
  actorUserId?: string;
}

export async function updateSleepingArrangement(tx: AppTx, input: UpdateSleepingArrangementInput) {
  const tenantId = requireCurrentTenantId();
  const { id, actorUserId, ...rest } = input;

  const [row] = await tx
    .update(unitSleepingArrangements)
    .set(rest)
    .where(
      and(eq(unitSleepingArrangements.id, id), eq(unitSleepingArrangements.tenantId, tenantId)),
    )
    .returning();
  if (!row) throw new SleepingArrangementNotFoundError(id);

  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: "SLEEPING_ARRANGEMENT_UPDATED",
    targetType: "unit_sleeping_arrangement",
    targetId: row.id,
    metadata: { unitId: row.unitId, bedType: row.bedType, quantity: row.quantity },
  });

  return row;
}

export async function deleteSleepingArrangement(
  tx: AppTx,
  id: string,
  actorUserId?: string,
): Promise<void> {
  const tenantId = requireCurrentTenantId();

  const [row] = await tx
    .delete(unitSleepingArrangements)
    .where(
      and(eq(unitSleepingArrangements.id, id), eq(unitSleepingArrangements.tenantId, tenantId)),
    )
    .returning();
  if (!row) throw new SleepingArrangementNotFoundError(id);

  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: "SLEEPING_ARRANGEMENT_DELETED",
    targetType: "unit_sleeping_arrangement",
    targetId: row.id,
    metadata: { unitId: row.unitId },
  });
}

export async function listSleepingArrangementsForUnit(tx: AppTx, unitId: string) {
  const tenantId = requireCurrentTenantId();
  return tx
    .select()
    .from(unitSleepingArrangements)
    .where(
      and(
        eq(unitSleepingArrangements.unitId, unitId),
        eq(unitSleepingArrangements.tenantId, tenantId),
      ),
    )
    .orderBy(unitSleepingArrangements.ordering);
}
