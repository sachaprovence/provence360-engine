import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { virtualTours } from "@provence360/database";
import {
  createProperty,
  createSite,
  createTenant,
  createUnit,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import {
  PropertyNotFoundError,
  UnitNotFoundError,
  VirtualTourConflictError,
  VirtualTourNotFoundError,
} from "./errors";
import "./providers";
import {
  createVirtualTour,
  deleteVirtualTour,
  getPublicVirtualTour,
  getVirtualTour,
  isPublicVirtualTourStatus,
  listVirtualToursForProperty,
  listVirtualToursForUnit,
  updateVirtualTour,
} from "./virtual-tour-repository";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

async function propertyFor(tenantId: string) {
  const site = await createSite({ tenantId });
  return createProperty({ tenantId, siteId: site.id });
}

describe("createVirtualTour", () => {
  it("creates a Property-level tour owned by the current tenant, normalizing the raw provider input", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);

    const tour = await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        provider: "matterport",
        rawProviderInput: "https://my.matterport.com/show/?m=abc12345678",
        internalName: "Tour principal",
        publicName: "Visite virtuelle",
      }),
    );

    expect(tour.tenantId).toBe(tenant.id);
    expect(tour.propertyId).toBe(property.id);
    expect(tour.unitId).toBeNull();
    expect(tour.providerAssetId).toBe("abc12345678");
    expect(tour.status).toBe("draft");
  });

  it("creates a Unit-level tour when unitId belongs to the same Property", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const unit = await createUnit({ tenantId: tenant.id, propertyId: property.id });

    const tour = await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        unitId: unit.id,
        provider: "matterport",
        rawProviderInput: "abc12345678",
        internalName: "Suite",
        publicName: "Suite",
      }),
    );

    expect(tour.unitId).toBe(unit.id);
  });

  it("refuses to attach a tour to another tenant's Property", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const propertyB = await propertyFor(tenantB.id);

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        createVirtualTour(tx, {
          propertyId: propertyB.id,
          provider: "matterport",
          rawProviderInput: "abc12345678",
          internalName: "Stolen",
          publicName: "Stolen",
        }),
      ),
    ).rejects.toThrow(PropertyNotFoundError);
  });

  it("refuses a unitId that belongs to a different Property of the SAME tenant (Postgres-enforced ownership, not merely a TypeScript check)", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const otherProperty = await propertyFor(tenant.id);
    const unitOfOtherProperty = await createUnit({
      tenantId: tenant.id,
      propertyId: otherProperty.id,
    });

    await expect(
      withTenantContext(tenant.id, (tx) =>
        createVirtualTour(tx, {
          propertyId: property.id,
          unitId: unitOfOtherProperty.id,
          provider: "matterport",
          rawProviderInput: "abc12345678",
          internalName: "Mismatched",
          publicName: "Mismatched",
        }),
      ),
    ).rejects.toThrow(UnitNotFoundError);
  });

  it("refuses a unitId belonging to another tenant entirely", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const propertyA = await propertyFor(tenantA.id);
    const propertyB = await propertyFor(tenantB.id);
    const unitB = await createUnit({ tenantId: tenantB.id, propertyId: propertyB.id });

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        createVirtualTour(tx, {
          propertyId: propertyA.id,
          unitId: unitB.id,
          provider: "matterport",
          rawProviderInput: "abc12345678",
          internalName: "Cross-tenant",
          publicName: "Cross-tenant",
        }),
      ),
    ).rejects.toThrow(UnitNotFoundError);
  });

  it("the composite FK rejects a forged tenant_id/property_id/unit_id triple even bypassing the repository helper", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const otherProperty = await propertyFor(tenant.id);
    const unitOfOtherProperty = await createUnit({
      tenantId: tenant.id,
      propertyId: otherProperty.id,
    });

    await expect(
      withTenantContext(tenant.id, (tx) =>
        tx.insert(virtualTours).values({
          tenantId: tenant.id,
          propertyId: property.id,
          unitId: unitOfOtherProperty.id,
          provider: "matterport",
          providerAssetId: "abc12345678",
          internalName: "Forged",
          publicName: "Forged",
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects an invalid rawProviderInput before any row is written", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);

    await expect(
      withTenantContext(tenant.id, (tx) =>
        createVirtualTour(tx, {
          propertyId: property.id,
          provider: "matterport",
          rawProviderInput: "https://evil.example/not-matterport",
          internalName: "Bad",
          publicName: "Bad",
        }),
      ),
    ).rejects.toThrow();

    const list = await withTenantContext(tenant.id, (tx) =>
      listVirtualToursForProperty(tx, property.id),
    );
    expect(list).toHaveLength(0);
  });
});

describe("updateVirtualTour / deleteVirtualTour", () => {
  it("refuses to update or delete another tenant's tour", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const propertyB = await propertyFor(tenantB.id);
    const tourB = await withTenantContext(tenantB.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: propertyB.id,
        provider: "matterport",
        rawProviderInput: "abc12345678",
        internalName: "B",
        publicName: "B",
      }),
    );

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        updateVirtualTour(tx, { id: tourB.id, status: "active" }),
      ),
    ).rejects.toThrow(VirtualTourNotFoundError);

    await expect(
      withTenantContext(tenantA.id, (tx) => deleteVirtualTour(tx, tourB.id)),
    ).rejects.toThrow(VirtualTourNotFoundError);

    const stillThere = await withTenantContext(tenantB.id, (tx) => getVirtualTour(tx, tourB.id));
    expect(stillThere).not.toBeNull();
  });

  it("re-normalizes a new rawProviderInput when repointing the tour to a different provider asset", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const tour = await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        provider: "matterport",
        rawProviderInput: "abc12345678",
        internalName: "T",
        publicName: "T",
      }),
    );

    const updated = await withTenantContext(tenant.id, (tx) =>
      updateVirtualTour(tx, {
        id: tour.id,
        rawProviderInput: "https://my.matterport.com/show/?m=xyz98765432",
      }),
    );
    expect(updated.providerAssetId).toBe("xyz98765432");
  });

  it("re-validates unit ownership when moving a tour to a different unit", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const otherProperty = await propertyFor(tenant.id);
    const unitOfOtherProperty = await createUnit({
      tenantId: tenant.id,
      propertyId: otherProperty.id,
    });
    const tour = await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        provider: "matterport",
        rawProviderInput: "abc12345678",
        internalName: "T",
        publicName: "T",
      }),
    );

    await expect(
      withTenantContext(tenant.id, (tx) =>
        updateVirtualTour(tx, { id: tour.id, unitId: unitOfOtherProperty.id }),
      ),
    ).rejects.toThrow(UnitNotFoundError);
  });

  it("setting unitId to null converts a Unit-level tour back into a Property-level one", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const unit = await createUnit({ tenantId: tenant.id, propertyId: property.id });
    const tour = await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        unitId: unit.id,
        provider: "matterport",
        rawProviderInput: "abc12345678",
        internalName: "T",
        publicName: "T",
      }),
    );

    const updated = await withTenantContext(tenant.id, (tx) =>
      updateVirtualTour(tx, { id: tour.id, unitId: null }),
    );
    expect(updated.unitId).toBeNull();
  });
});

describe("updateVirtualTour optimistic concurrency (expectedUpdatedAt)", () => {
  it("succeeds when expectedUpdatedAt matches the tour's current updatedAt", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const tour = await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        provider: "matterport",
        rawProviderInput: "abc12345678",
        internalName: "T",
        publicName: "T",
      }),
    );

    const updated = await withTenantContext(tenant.id, (tx) =>
      updateVirtualTour(tx, { id: tour.id, status: "active", expectedUpdatedAt: tour.updatedAt }),
    );
    expect(updated.status).toBe("active");
  });

  it("throws VirtualTourConflictError when expectedUpdatedAt is stale", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const tour = await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        provider: "matterport",
        rawProviderInput: "abc12345678",
        internalName: "T",
        publicName: "T",
      }),
    );

    await withTenantContext(tenant.id, (tx) =>
      updateVirtualTour(tx, { id: tour.id, status: "active" }),
    );

    await expect(
      withTenantContext(tenant.id, (tx) =>
        updateVirtualTour(tx, {
          id: tour.id,
          status: "archived",
          expectedUpdatedAt: tour.updatedAt,
        }),
      ),
    ).rejects.toThrow(VirtualTourConflictError);

    const stillActive = await withTenantContext(tenant.id, (tx) => getVirtualTour(tx, tour.id));
    expect(stillActive?.status).toBe("active");
  });
});

describe("isPublicVirtualTourStatus / getPublicVirtualTour", () => {
  it("only 'active' is public; draft and archived are not", () => {
    expect(isPublicVirtualTourStatus("active")).toBe(true);
    expect(isPublicVirtualTourStatus("draft")).toBe(false);
    expect(isPublicVirtualTourStatus("archived")).toBe(false);
  });

  it("getPublicVirtualTour resolves an active tour but not a draft or archived one", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const active = await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        provider: "matterport",
        rawProviderInput: "aaa11111111",
        internalName: "Active",
        publicName: "Active",
        status: "active",
      }),
    );
    const draft = await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        provider: "matterport",
        rawProviderInput: "bbb22222222",
        internalName: "Draft",
        publicName: "Draft",
      }),
    );
    const archived = await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        provider: "matterport",
        rawProviderInput: "ccc33333333",
        internalName: "Archived",
        publicName: "Archived",
        status: "archived",
      }),
    );

    expect(
      await withTenantContext(tenant.id, (tx) => getPublicVirtualTour(tx, active.id)),
    ).not.toBeNull();
    expect(
      await withTenantContext(tenant.id, (tx) => getPublicVirtualTour(tx, draft.id)),
    ).toBeNull();
    expect(
      await withTenantContext(tenant.id, (tx) => getPublicVirtualTour(tx, archived.id)),
    ).toBeNull();
  });
});

describe("listVirtualToursForProperty / listVirtualToursForUnit", () => {
  it("returns Property tours ordered by their `ordering` column", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        provider: "matterport",
        rawProviderInput: "ccc33333333",
        internalName: "C",
        publicName: "C",
        ordering: 2,
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        provider: "matterport",
        rawProviderInput: "aaa11111111",
        internalName: "A",
        publicName: "A",
        ordering: 0,
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        provider: "matterport",
        rawProviderInput: "bbb22222222",
        internalName: "B",
        publicName: "B",
        ordering: 1,
      }),
    );

    const list = await withTenantContext(tenant.id, (tx) =>
      listVirtualToursForProperty(tx, property.id),
    );
    expect(list.map((t) => t.internalName)).toEqual(["A", "B", "C"]);
  });

  it("listVirtualToursForUnit excludes Property-level tours (unitId IS NULL)", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const unit = await createUnit({ tenantId: tenant.id, propertyId: property.id });
    await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        provider: "matterport",
        rawProviderInput: "aaa11111111",
        internalName: "Property-level",
        publicName: "Property-level",
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      createVirtualTour(tx, {
        propertyId: property.id,
        unitId: unit.id,
        provider: "matterport",
        rawProviderInput: "bbb22222222",
        internalName: "Unit-level",
        publicName: "Unit-level",
      }),
    );

    const list = await withTenantContext(tenant.id, (tx) => listVirtualToursForUnit(tx, unit.id));
    expect(list.map((t) => t.internalName)).toEqual(["Unit-level"]);
  });
});
