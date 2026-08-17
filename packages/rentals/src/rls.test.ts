import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { propertyAmenities, unitSleepingArrangements } from "@provence360/database";
import {
  createAmenity,
  createProperty,
  createSite,
  createTenant,
  createUnit,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";

// Real-Postgres RLS tests for the v0.6 tables (unit_sleeping_arrangements,
// property_amenities), exercised with raw queries against
// `provence360_app` (via withTenantContext) — deliberately bypassing
// packages/rentals' own repository functions, which already re-derive
// everything through a tenant-scoped read. The point here is to prove the
// database-level boundary itself, independent of any application code ever
// getting it right — same pattern as packages/publishing's rls.test.ts.

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

describe("RLS: unit_sleeping_arrangements", () => {
  it("tenant A cannot read tenant B's sleeping arrangements, even by guessing the exact row id", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const unitB = await unitFor(tenantB.id);
    const { getAdminDb } = await import("@provence360/database/admin");
    const [rowB] = await getAdminDb()
      .insert(unitSleepingArrangements)
      .values({ tenantId: tenantB.id, unitId: unitB.id, bedType: "king", quantity: 1 })
      .returning();
    if (!rowB) throw new Error("Failed to create test sleeping arrangement");

    const rows = await withTenantContext(tenantA.id, (tx) =>
      tx.select().from(unitSleepingArrangements).where(eq(unitSleepingArrangements.id, rowB.id)),
    );
    expect(rows).toHaveLength(0);
  });

  it("a query with no tenant context at all sees nothing (fail closed)", async () => {
    const tenant = await createTenant();
    const unit = await unitFor(tenant.id);
    const { getAdminDb } = await import("@provence360/database/admin");
    await getAdminDb()
      .insert(unitSleepingArrangements)
      .values({ tenantId: tenant.id, unitId: unit.id, bedType: "king", quantity: 1 });

    const { getAppDb } = await import("@provence360/database/client-app");
    const rows = await getAppDb().select().from(unitSleepingArrangements);
    expect(rows).toHaveLength(0);
  });

  it("provence360_app cannot INSERT a row claiming a different tenant's tenant_id than its own context (withCheck)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const unitB = await unitFor(tenantB.id);

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        tx.insert(unitSleepingArrangements).values({
          tenantId: tenantB.id,
          unitId: unitB.id,
          bedType: "king",
          quantity: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it("the composite FK rejects a forged tenant_id/unit_id pair even bypassing RLS's own INSERT check", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const unitB = await unitFor(tenantB.id);

    // tenant_id matches the acting tenant (passes withCheck) but unit_id
    // belongs to a different tenant entirely — the composite FK
    // (tenant_id, unit_id) -> units(tenant_id, id) must still reject this.
    await expect(
      withTenantContext(tenantA.id, (tx) =>
        tx.insert(unitSleepingArrangements).values({
          tenantId: tenantA.id,
          unitId: unitB.id,
          bedType: "king",
          quantity: 1,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("RLS: property_amenities", () => {
  it("tenant A cannot read tenant B's property amenity attachments", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const site = await createSite({ tenantId: tenantB.id });
    const propertyB = await createProperty({ tenantId: tenantB.id, siteId: site.id });
    const amenity = await createAmenity({ key: "pool" });
    const { getAdminDb } = await import("@provence360/database/admin");
    const [rowB] = await getAdminDb()
      .insert(propertyAmenities)
      .values({ tenantId: tenantB.id, propertyId: propertyB.id, amenityId: amenity.id })
      .returning();
    if (!rowB) throw new Error("Failed to create test property amenity");

    const rows = await withTenantContext(tenantA.id, (tx) =>
      tx.select().from(propertyAmenities).where(eq(propertyAmenities.id, rowB.id)),
    );
    expect(rows).toHaveLength(0);
  });

  it("provence360_app cannot INSERT a row claiming a different tenant's tenant_id than its own context (withCheck)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const site = await createSite({ tenantId: tenantB.id });
    const propertyB = await createProperty({ tenantId: tenantB.id, siteId: site.id });
    const amenity = await createAmenity({ key: "pool" });

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        tx.insert(propertyAmenities).values({
          tenantId: tenantB.id,
          propertyId: propertyB.id,
          amenityId: amenity.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it("the composite FK rejects a forged tenant_id/property_id pair", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const site = await createSite({ tenantId: tenantB.id });
    const propertyB = await createProperty({ tenantId: tenantB.id, siteId: site.id });
    const amenity = await createAmenity({ key: "pool" });

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        tx.insert(propertyAmenities).values({
          tenantId: tenantA.id,
          propertyId: propertyB.id,
          amenityId: amenity.id,
        }),
      ),
    ).rejects.toThrow();
  });
});
