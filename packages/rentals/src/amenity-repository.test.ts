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
  listAmenitiesForProperty,
  listAmenitiesForUnit,
  setPropertyAmenities,
  setUnitAmenities,
} from "./amenity-repository";
import { PropertyNotFoundError, UnitNotFoundError } from "./errors";

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

async function propertyFor(tenantId: string) {
  const site = await createSite({ tenantId });
  return createProperty({ tenantId, siteId: site.id });
}

describe("setPropertyAmenities / listAmenitiesForProperty (v0.6 property-level amenities)", () => {
  it("attaches amenities to a property owned by the current tenant, distinct from any of its units' amenities", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const unit = await createUnit({ tenantId: tenant.id, propertyId: property.id });
    const pool = await createAmenity({ key: "pool" });
    const wifi = await createAmenity({ key: "wifi" });

    await withTenantContext(tenant.id, (tx) => setPropertyAmenities(tx, property.id, [pool.id]));
    await withTenantContext(tenant.id, (tx) => setUnitAmenities(tx, unit.id, [wifi.id]));

    const propertyAmenityList = await withTenantContext(tenant.id, (tx) =>
      listAmenitiesForProperty(tx, property.id),
    );
    expect(propertyAmenityList.map((a) => a.key)).toEqual(["pool"]);

    const unitAmenityList = await withTenantContext(tenant.id, (tx) =>
      listAmenitiesForUnit(tx, unit.id),
    );
    expect(unitAmenityList.map((a) => a.key)).toEqual(["wifi"]);
  });

  it("refuses to attach amenities to another tenant's property", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const propertyB = await propertyFor(tenantB.id);
    const wifi = await createAmenity({ key: "wifi" });

    await expect(
      withTenantContext(tenantA.id, (tx) => setPropertyAmenities(tx, propertyB.id, [wifi.id])),
    ).rejects.toThrow(PropertyNotFoundError);
  });

  it("is idempotent/replacing, same as setUnitAmenities", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const wifi = await createAmenity({ key: "wifi" });
    const pool = await createAmenity({ key: "pool" });

    await withTenantContext(tenant.id, (tx) =>
      setPropertyAmenities(tx, property.id, [wifi.id, pool.id]),
    );
    await withTenantContext(tenant.id, (tx) => setPropertyAmenities(tx, property.id, [wifi.id]));

    const attached = await withTenantContext(tenant.id, (tx) =>
      listAmenitiesForProperty(tx, property.id),
    );
    expect(attached.map((a) => a.key)).toEqual(["wifi"]);
  });
});

describe("amenity metadata validation (previously entirely unvalidated)", () => {
  it("accepts a valid, closed metadata shape ({ featured, note })", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const pool = await createAmenity({ key: "pool" });

    await withTenantContext(tenant.id, (tx) =>
      setPropertyAmenities(tx, property.id, [
        { amenityId: pool.id, metadata: { featured: true, note: "Heated year-round" } },
      ]),
    );

    const [attached] = await withTenantContext(tenant.id, (tx) =>
      listAmenitiesForProperty(tx, property.id),
    );
    expect(attached?.metadata).toEqual({ featured: true, note: "Heated year-round" });
  });

  it("rejects an unknown metadata key instead of silently storing it", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const pool = await createAmenity({ key: "pool" });

    await expect(
      withTenantContext(tenant.id, (tx) =>
        setPropertyAmenities(tx, property.id, [
          { amenityId: pool.id, metadata: { heated: true } as never },
        ]),
      ),
    ).rejects.toThrow();
  });

  it("bare amenity ids (pre-v0.6 shape) still default to empty metadata", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const unit = await createUnit({ tenantId: tenant.id, propertyId: property.id });
    const wifi = await createAmenity({ key: "wifi" });

    await withTenantContext(tenant.id, (tx) => setUnitAmenities(tx, unit.id, [wifi.id]));

    const [attached] = await withTenantContext(tenant.id, (tx) =>
      listAmenitiesForUnit(tx, unit.id),
    );
    expect(attached?.metadata).toEqual({});
  });
});
