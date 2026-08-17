import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createProperty,
  createSite,
  createTenant,
  createUnit,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { SleepingArrangementNotFoundError, UnitNotFoundError } from "./errors";
import {
  createSleepingArrangement,
  deleteSleepingArrangement,
  listSleepingArrangementsForUnit,
  updateSleepingArrangement,
} from "./sleeping-arrangement-repository";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

async function unitFor(tenantId: string) {
  const site = await createSite({ tenantId });
  const property = await createProperty({ tenantId, siteId: site.id });
  return createUnit({ tenantId, propertyId: property.id });
}

describe("createSleepingArrangement", () => {
  it("adds a sleeping-space row to a unit owned by the current tenant", async () => {
    const tenant = await createTenant();
    const unit = await unitFor(tenant.id);

    const row = await withTenantContext(tenant.id, (tx) =>
      createSleepingArrangement(tx, {
        unitId: unit.id,
        roomLabel: "Bedroom 1",
        bedType: "king",
        quantity: 1,
      }),
    );

    expect(row.tenantId).toBe(tenant.id);
    expect(row.unitId).toBe(unit.id);
    expect(row.bedType).toBe("king");
    expect(row.quantity).toBe(1);
  });

  it("refuses to attach a sleeping arrangement to another tenant's unit", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const unitB = await unitFor(tenantB.id);

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        createSleepingArrangement(tx, { unitId: unitB.id, bedType: "double" }),
      ),
    ).rejects.toThrow(UnitNotFoundError);
  });

  it("the database rejects a non-positive quantity (CHECK constraint)", async () => {
    const tenant = await createTenant();
    const unit = await unitFor(tenant.id);

    await expect(
      withTenantContext(tenant.id, (tx) =>
        createSleepingArrangement(tx, { unitId: unit.id, bedType: "double", quantity: 0 }),
      ),
    ).rejects.toThrow();
  });
});

describe("listSleepingArrangementsForUnit — ordering", () => {
  it("returns rows ordered by their `ordering` column, independent of insertion order", async () => {
    const tenant = await createTenant();
    const unit = await unitFor(tenant.id);

    await withTenantContext(tenant.id, (tx) =>
      createSleepingArrangement(tx, {
        unitId: unit.id,
        roomLabel: "Living room",
        bedType: "sofa_bed",
        ordering: 2,
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      createSleepingArrangement(tx, {
        unitId: unit.id,
        roomLabel: "Bedroom 1",
        bedType: "king",
        ordering: 0,
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      createSleepingArrangement(tx, {
        unitId: unit.id,
        roomLabel: "Bedroom 2",
        bedType: "double",
        ordering: 1,
      }),
    );

    const list = await withTenantContext(tenant.id, (tx) =>
      listSleepingArrangementsForUnit(tx, unit.id),
    );
    expect(list.map((row) => row.roomLabel)).toEqual(["Bedroom 1", "Bedroom 2", "Living room"]);
  });

  it("a cross-tenant unitId yields zero rows, never another tenant's sleeping arrangements", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const unitB = await unitFor(tenantB.id);
    await withTenantContext(tenantB.id, (tx) =>
      createSleepingArrangement(tx, { unitId: unitB.id, bedType: "king" }),
    );

    const crossTenant = await withTenantContext(tenantA.id, (tx) =>
      listSleepingArrangementsForUnit(tx, unitB.id),
    );
    expect(crossTenant).toEqual([]);
  });
});

describe("updateSleepingArrangement / deleteSleepingArrangement", () => {
  it("updates a row owned by the current tenant", async () => {
    const tenant = await createTenant();
    const unit = await unitFor(tenant.id);
    const row = await withTenantContext(tenant.id, (tx) =>
      createSleepingArrangement(tx, { unitId: unit.id, bedType: "double", quantity: 1 }),
    );

    const updated = await withTenantContext(tenant.id, (tx) =>
      updateSleepingArrangement(tx, { id: row.id, quantity: 2 }),
    );
    expect(updated.quantity).toBe(2);
  });

  it("refuses to update or delete another tenant's sleeping arrangement", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const unitB = await unitFor(tenantB.id);
    const rowB = await withTenantContext(tenantB.id, (tx) =>
      createSleepingArrangement(tx, { unitId: unitB.id, bedType: "double" }),
    );

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        updateSleepingArrangement(tx, { id: rowB.id, quantity: 5 }),
      ),
    ).rejects.toThrow(SleepingArrangementNotFoundError);

    await expect(
      withTenantContext(tenantA.id, (tx) => deleteSleepingArrangement(tx, rowB.id)),
    ).rejects.toThrow(SleepingArrangementNotFoundError);

    const stillThere = await withTenantContext(tenantB.id, (tx) =>
      listSleepingArrangementsForUnit(tx, unitB.id),
    );
    expect(stillThere).toHaveLength(1);
  });

  it("deletes a row owned by the current tenant", async () => {
    const tenant = await createTenant();
    const unit = await unitFor(tenant.id);
    const row = await withTenantContext(tenant.id, (tx) =>
      createSleepingArrangement(tx, { unitId: unit.id, bedType: "double" }),
    );

    await withTenantContext(tenant.id, (tx) => deleteSleepingArrangement(tx, row.id));

    const remaining = await withTenantContext(tenant.id, (tx) =>
      listSleepingArrangementsForUnit(tx, unit.id),
    );
    expect(remaining).toEqual([]);
  });
});
