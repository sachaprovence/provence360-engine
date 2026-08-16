import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import {
  amenitiesExist,
  listAmenities,
  listAmenitiesForUnit,
  setUnitAmenities,
} from "./amenity-repository";
import { UnitNotFoundError } from "./errors";

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

describe("listAmenities", () => {
  it("returns the shared, platform-level catalog to any tenant context", async () => {
    const tenant = await createTenant();
    await createAmenity({ key: "wifi", category: "connectivity", label: "WiFi" });
    await createAmenity({ key: "pool", category: "outdoor", label: "Pool" });

    const list = await withTenantContext(tenant.id, (tx) => listAmenities(tx));
    expect(list.map((a) => a.key).sort()).toEqual(["pool", "wifi"]);
  });
});

describe("setUnitAmenities", () => {
  it("attaches amenities to a unit owned by the current tenant", async () => {
    const tenant = await createTenant();
    const unit = await unitFor(tenant.id);
    const wifi = await createAmenity({ key: "wifi" });
    const pool = await createAmenity({ key: "pool" });

    await withTenantContext(tenant.id, (tx) => setUnitAmenities(tx, unit.id, [wifi.id, pool.id]));

    const attached = await withTenantContext(tenant.id, (tx) => listAmenitiesForUnit(tx, unit.id));
    expect(attached.map((a) => a.key).sort()).toEqual(["pool", "wifi"]);
  });

  it("is idempotent/replacing — calling it again with a smaller set removes what's no longer listed", async () => {
    const tenant = await createTenant();
    const unit = await unitFor(tenant.id);
    const wifi = await createAmenity({ key: "wifi" });
    const pool = await createAmenity({ key: "pool" });

    await withTenantContext(tenant.id, (tx) => setUnitAmenities(tx, unit.id, [wifi.id, pool.id]));
    await withTenantContext(tenant.id, (tx) => setUnitAmenities(tx, unit.id, [wifi.id]));

    const attached = await withTenantContext(tenant.id, (tx) => listAmenitiesForUnit(tx, unit.id));
    expect(attached.map((a) => a.key)).toEqual(["wifi"]);
  });

  it("refuses to attach amenities to another tenant's unit", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const unitB = await unitFor(tenantB.id);
    const wifi = await createAmenity({ key: "wifi" });

    await expect(
      withTenantContext(tenantA.id, (tx) => setUnitAmenities(tx, unitB.id, [wifi.id])),
    ).rejects.toThrow(UnitNotFoundError);
  });

  it("rejects an amenity id that isn't a real catalog row (foreign key)", async () => {
    const tenant = await createTenant();
    const unit = await unitFor(tenant.id);

    await expect(
      withTenantContext(tenant.id, (tx) =>
        setUnitAmenities(tx, unit.id, ["00000000-0000-0000-0000-000000000000"]),
      ),
    ).rejects.toThrow();
  });
});

describe("amenitiesExist", () => {
  it("confirms a set of real ids all exist", async () => {
    const tenant = await createTenant();
    const wifi = await createAmenity({ key: "wifi" });
    const pool = await createAmenity({ key: "pool" });

    const exists = await withTenantContext(tenant.id, (tx) =>
      amenitiesExist(tx, [wifi.id, pool.id]),
    );
    expect(exists).toBe(true);
  });

  it("returns false when any id is not a real catalog row", async () => {
    const tenant = await createTenant();
    const wifi = await createAmenity({ key: "wifi" });

    const exists = await withTenantContext(tenant.id, (tx) =>
      amenitiesExist(tx, [wifi.id, "00000000-0000-0000-0000-000000000000"]),
    );
    expect(exists).toBe(false);
  });
});
