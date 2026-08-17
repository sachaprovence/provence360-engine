import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AppTx, VirtualTourProvider, VirtualTourStatus } from "@provence360/database";
import { properties, units, virtualTours } from "@provence360/database";
import { recordAuditLog } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import {
  PropertyNotFoundError,
  UnitNotFoundError,
  VirtualTourConflictError,
  VirtualTourNotFoundError,
} from "./errors";
import { virtualTourProviderRegistry } from "./provider-registry";

// See packages/sites/src/site-repository.ts's `eqUpdatedAtMs` for why this
// truncates to millisecond precision rather than a plain `eq()`.
function eqUpdatedAtMs(column: typeof virtualTours.updatedAt, expected: Date): SQL {
  return sql`date_trunc('milliseconds', ${column}) = date_trunc('milliseconds', ${expected.toISOString()}::timestamptz)`;
}

/**
 * A VirtualTour is shown on the public site only when `active` — the same
 * three-state shape (`draft`/`active`/`archived`) as `isPublicPropertyStatus`/
 * `isPublicUnitStatus` in `@provence360/rentals`, kept as a locally-owned
 * predicate here rather than a cross-package import: `packages/virtual-tours`
 * deliberately has no dependency on `@provence360/rentals` (it queries
 * `properties`/`units` directly, the same way `packages/rentals` itself
 * queries its own parent tables — see `assertPropertyOwnership`/
 * `assertUnitOwnership` below).
 */
export function isPublicVirtualTourStatus(status: VirtualTourStatus): boolean {
  return status === "active";
}

async function assertPropertyOwnership(
  tx: AppTx,
  propertyId: string,
  tenantId: string,
): Promise<void> {
  const [property] = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.tenantId, tenantId)));
  if (!property) throw new PropertyNotFoundError(propertyId);
}

/** Confirms `unitId` belongs to both the current tenant AND `propertyId` — the composite FK (`virtual_tours_tenant_property_unit_fk`) is the real, unbypassable guarantee; this is the same "fail with a clean domain error before hitting the raw constraint violation" pattern every other ownership check in this codebase uses. */
async function assertUnitBelongsToProperty(
  tx: AppTx,
  unitId: string,
  propertyId: string,
  tenantId: string,
): Promise<void> {
  const [unit] = await tx
    .select({ id: units.id })
    .from(units)
    .where(
      and(eq(units.id, unitId), eq(units.propertyId, propertyId), eq(units.tenantId, tenantId)),
    );
  if (!unit) throw new UnitNotFoundError(unitId);
}

export interface CreateVirtualTourInput {
  propertyId: string;
  unitId?: string;
  provider: VirtualTourProvider;
  /** Admin-facing raw input (a pasted share URL, or a bare provider id) — normalized via the provider registry before it ever reaches the database. Never stored as-is. */
  rawProviderInput: string;
  internalName: string;
  publicName: string;
  status?: VirtualTourStatus;
  ordering?: number;
  actorUserId?: string;
}

/**
 * Creates a VirtualTour owned by the current tenant, attached to a
 * Property (always) and optionally a Unit of that same Property — same
 * ownership-check-then-composite-FK pattern as `createUnit`/`createProperty`
 * in `packages/rentals`. `rawProviderInput` is normalized through
 * `input.provider`'s registered adapter — a value that doesn't parse as
 * that provider's format throws `InvalidVirtualTourProviderInputError`
 * before any database write is attempted.
 */
export async function createVirtualTour(tx: AppTx, input: CreateVirtualTourInput) {
  const tenantId = requireCurrentTenantId();

  await assertPropertyOwnership(tx, input.propertyId, tenantId);
  if (input.unitId) {
    await assertUnitBelongsToProperty(tx, input.unitId, input.propertyId, tenantId);
  }

  const { providerAssetId } = virtualTourProviderRegistry
    .require(input.provider)
    .normalize(input.rawProviderInput);

  const [row] = await tx
    .insert(virtualTours)
    .values({
      tenantId,
      propertyId: input.propertyId,
      unitId: input.unitId,
      provider: input.provider,
      providerAssetId,
      internalName: input.internalName,
      publicName: input.publicName,
      status: input.status ?? "draft",
      ordering: input.ordering ?? 0,
    })
    .returning();
  if (!row) throw new Error("Failed to create virtual tour");

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "VIRTUAL_TOUR_CREATED",
    targetType: "virtual_tour",
    targetId: row.id,
    metadata: { provider: row.provider, propertyId: row.propertyId, unitId: row.unitId },
  });

  return row;
}

export interface UpdateVirtualTourInput {
  id: string;
  unitId?: string | null;
  /** Set together with `provider` to change which provider asset this tour points at. */
  rawProviderInput?: string;
  provider?: VirtualTourProvider;
  internalName?: string;
  publicName?: string;
  status?: VirtualTourStatus;
  ordering?: number;
  actorUserId?: string;
  /** Optimistic-concurrency token — see {@link VirtualTourConflictError}. Opt-in: omitted, unconditional last-write-wins (same as `packages/sites`/`packages/rentals`). */
  expectedUpdatedAt?: Date;
}

export async function updateVirtualTour(tx: AppTx, input: UpdateVirtualTourInput) {
  const tenantId = requireCurrentTenantId();
  const { id, actorUserId, unitId, rawProviderInput, provider, expectedUpdatedAt, ...rest } = input;

  const [existing] = await tx
    .select()
    .from(virtualTours)
    .where(and(eq(virtualTours.id, id), eq(virtualTours.tenantId, tenantId)));
  if (!existing) throw new VirtualTourNotFoundError(id);

  if (unitId !== undefined && unitId !== null) {
    await assertUnitBelongsToProperty(tx, unitId, existing.propertyId, tenantId);
  }

  const effectiveProvider = provider ?? existing.provider;
  const providerAssetId =
    rawProviderInput !== undefined
      ? virtualTourProviderRegistry.require(effectiveProvider).normalize(rawProviderInput)
          .providerAssetId
      : undefined;

  const [row] = await tx
    .update(virtualTours)
    .set({
      ...rest,
      ...(unitId !== undefined ? { unitId } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(providerAssetId !== undefined ? { providerAssetId } : {}),
    })
    .where(
      expectedUpdatedAt
        ? and(
            eq(virtualTours.id, id),
            eq(virtualTours.tenantId, tenantId),
            eqUpdatedAtMs(virtualTours.updatedAt, expectedUpdatedAt),
          )
        : and(eq(virtualTours.id, id), eq(virtualTours.tenantId, tenantId)),
    )
    .returning();
  if (!row) {
    if (expectedUpdatedAt) throw new VirtualTourConflictError(id);
    throw new VirtualTourNotFoundError(id);
  }

  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: "VIRTUAL_TOUR_UPDATED",
    targetType: "virtual_tour",
    targetId: row.id,
    metadata: {
      provider: row.provider,
      propertyId: row.propertyId,
      unitId: row.unitId,
      status: row.status,
    },
  });

  return row;
}

export async function deleteVirtualTour(
  tx: AppTx,
  id: string,
  actorUserId?: string,
): Promise<void> {
  const tenantId = requireCurrentTenantId();

  const [row] = await tx
    .delete(virtualTours)
    .where(and(eq(virtualTours.id, id), eq(virtualTours.tenantId, tenantId)))
    .returning();
  if (!row) throw new VirtualTourNotFoundError(id);

  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: "VIRTUAL_TOUR_DELETED",
    targetType: "virtual_tour",
    targetId: row.id,
    metadata: { provider: row.provider, propertyId: row.propertyId },
  });
}

export async function getVirtualTour(tx: AppTx, id: string) {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .select()
    .from(virtualTours)
    .where(and(eq(virtualTours.id, id), eq(virtualTours.tenantId, tenantId)));
  return row ?? null;
}

/** Same lookup as `getVirtualTour`, additionally gated on {@link isPublicVirtualTourStatus} — the one function every public-facing caller (the renderer, publish-time domain reference validation) should use instead of `getVirtualTour`. */
export async function getPublicVirtualTour(tx: AppTx, id: string) {
  const row = await getVirtualTour(tx, id);
  return row && isPublicVirtualTourStatus(row.status) ? row : null;
}

export async function listVirtualToursForProperty(tx: AppTx, propertyId: string) {
  const tenantId = requireCurrentTenantId();
  return tx
    .select()
    .from(virtualTours)
    .where(and(eq(virtualTours.propertyId, propertyId), eq(virtualTours.tenantId, tenantId)))
    .orderBy(virtualTours.ordering);
}

/** Tours whose `unitId` matches exactly — a Property-level tour (`unitId IS NULL`) is not included here; a caller wanting "everything relevant to this Unit's page" combines this with the Property's own tours explicitly, a display-layer choice this repository stays neutral about. */
export async function listVirtualToursForUnit(tx: AppTx, unitId: string) {
  const tenantId = requireCurrentTenantId();
  return tx
    .select()
    .from(virtualTours)
    .where(and(eq(virtualTours.unitId, unitId), eq(virtualTours.tenantId, tenantId)))
    .orderBy(virtualTours.ordering);
}
