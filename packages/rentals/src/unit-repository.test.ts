import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { units } from "@provence360/database";
import {
  createProperty,
  createSite,
  createTenant,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { PropertyNotFoundError, UnitConflictError, UnitNotFoundError } from "./errors";
import {
  createUnit,
  deleteUnit,
  getPublicUnit,
  getUnit,
  isPublicUnitStatus,
  listPublicUnitsForProperty,
  listUnitsForProperty,
  updateUnit,
} from "./unit-repository";

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

describe("createUnit", () => {
  it("creates a unit attached to a property owned by the current tenant", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);

    const unit = await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, {
        propertyId: property.id,
        internalName: "Villa principale",
        publicName: "Villa principale",
        slug: "villa-principale",
        maxGuests: 8,
        bedrooms: 4,
        bathrooms: 2.5,
      }),
    );

    expect(unit.tenantId).toBe(tenant.id);
    expect(unit.propertyId).toBe(property.id);
    expect(unit.bathrooms).toBe("2.5");
  });

  it("allows a single Property to hold multiple Units — 1 site != 1 logement", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);

    await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, {
        propertyId: property.id,
        slug: "main-villa",
        internalName: "Main",
        publicName: "Main",
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, {
        propertyId: property.id,
        slug: "studio",
        internalName: "Studio",
        publicName: "Studio",
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, {
        propertyId: property.id,
        slug: "room",
        internalName: "Room",
        publicName: "Room",
      }),
    );

    const list = await withTenantContext(tenant.id, (tx) => listUnitsForProperty(tx, property.id));
    expect(list).toHaveLength(3);
  });

  it("refuses to attach a unit to another tenant's property", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const propertyB = await propertyFor(tenantB.id);

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        createUnit(tx, {
          propertyId: propertyB.id,
          internalName: "Stolen",
          publicName: "Stolen",
          slug: "stolen",
        }),
      ),
    ).rejects.toThrow(PropertyNotFoundError);
  });

  it("the composite FK rejects a forged tenant_id even bypassing the repository helper", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const propertyB = await propertyFor(tenantB.id);

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        tx.insert(units).values({
          tenantId: tenantA.id,
          propertyId: propertyB.id,
          internalName: "Forged",
          publicName: "Forged",
          slug: "forged",
        }),
      ),
    ).rejects.toThrow();
  });

  it("the database rejects size without sizeUnit (and vice versa)", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);

    await expect(
      withTenantContext(tenant.id, (tx) =>
        tx.insert(units).values({
          tenantId: tenant.id,
          propertyId: property.id,
          internalName: "Bad",
          publicName: "Bad",
          slug: "bad",
          size: "45",
          // sizeUnit intentionally omitted
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("updateUnit / deleteUnit", () => {
  it("refuses to update or delete another tenant's unit", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const propertyB = await propertyFor(tenantB.id);
    const unitB = await withTenantContext(tenantB.id, (tx) =>
      createUnit(tx, { propertyId: propertyB.id, internalName: "B", publicName: "B", slug: "b" }),
    );

    await expect(
      withTenantContext(tenantA.id, (tx) => updateUnit(tx, { id: unitB.id, status: "archived" })),
    ).rejects.toThrow(UnitNotFoundError);

    await expect(withTenantContext(tenantA.id, (tx) => deleteUnit(tx, unitB.id))).rejects.toThrow(
      UnitNotFoundError,
    );

    const stillThere = await withTenantContext(tenantB.id, (tx) => getUnit(tx, unitB.id));
    expect(stillThere).not.toBeNull();
  });
});

describe("listUnitsForProperty", () => {
  it("returns units ordered by their `ordering` column", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);

    await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, {
        propertyId: property.id,
        internalName: "C",
        publicName: "C",
        slug: "c",
        ordering: 2,
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, {
        propertyId: property.id,
        internalName: "A",
        publicName: "A",
        slug: "a",
        ordering: 0,
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, {
        propertyId: property.id,
        internalName: "B",
        publicName: "B",
        slug: "b",
        ordering: 1,
      }),
    );

    const list = await withTenantContext(tenant.id, (tx) => listUnitsForProperty(tx, property.id));
    expect(list.map((u) => u.slug)).toEqual(["a", "b", "c"]);
  });
});

describe("isPublicUnitStatus / getPublicUnit / listPublicUnitsForProperty (v0.6 public visibility)", () => {
  it("active and not_bookable_separately are public; draft and archived are not", () => {
    expect(isPublicUnitStatus("active")).toBe(true);
    expect(isPublicUnitStatus("not_bookable_separately")).toBe(true);
    expect(isPublicUnitStatus("draft")).toBe(false);
    expect(isPublicUnitStatus("archived")).toBe(false);
  });

  it("getPublicUnit resolves an active unit but not a draft or archived one", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const active = await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, {
        propertyId: property.id,
        internalName: "Active",
        publicName: "Active",
        slug: "active",
        status: "active",
      }),
    );
    const draft = await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, {
        propertyId: property.id,
        internalName: "Draft",
        publicName: "Draft",
        slug: "draft",
        status: "draft",
      }),
    );
    const archived = await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, {
        propertyId: property.id,
        internalName: "Archived",
        publicName: "Archived",
        slug: "archived",
        status: "archived",
      }),
    );

    expect(await withTenantContext(tenant.id, (tx) => getPublicUnit(tx, active.id))).not.toBeNull();
    expect(await withTenantContext(tenant.id, (tx) => getPublicUnit(tx, draft.id))).toBeNull();
    expect(await withTenantContext(tenant.id, (tx) => getPublicUnit(tx, archived.id))).toBeNull();
  });

  it("listPublicUnitsForProperty excludes draft/archived units — a Property later archiving one of its Units stops showing it publicly while the Unit row itself stays intact", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, {
        propertyId: property.id,
        internalName: "Active",
        publicName: "Active",
        slug: "active",
        status: "active",
      }),
    );
    const toArchive = await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, {
        propertyId: property.id,
        internalName: "Soon Archived",
        publicName: "Soon Archived",
        slug: "soon-archived",
        status: "active",
      }),
    );

    let publicList = await withTenantContext(tenant.id, (tx) =>
      listPublicUnitsForProperty(tx, property.id),
    );
    expect(publicList.map((u) => u.slug).sort()).toEqual(["active", "soon-archived"]);

    await withTenantContext(tenant.id, (tx) =>
      updateUnit(tx, { id: toArchive.id, status: "archived" }),
    );

    publicList = await withTenantContext(tenant.id, (tx) =>
      listPublicUnitsForProperty(tx, property.id),
    );
    expect(publicList.map((u) => u.slug)).toEqual(["active"]);

    // The row itself is untouched — still fully readable/editable in admin.
    const stillThere = await withTenantContext(tenant.id, (tx) => getUnit(tx, toArchive.id));
    expect(stillThere?.status).toBe("archived");
  });
});

describe("updateUnit optimistic concurrency (expectedUpdatedAt)", () => {
  it("succeeds when expectedUpdatedAt matches the unit's current updatedAt", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const unit = await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, { propertyId: property.id, internalName: "U", publicName: "U", slug: "u" }),
    );

    const updated = await withTenantContext(tenant.id, (tx) =>
      updateUnit(tx, { id: unit.id, status: "active", expectedUpdatedAt: unit.updatedAt }),
    );
    expect(updated.status).toBe("active");
  });

  it("throws UnitConflictError when expectedUpdatedAt is stale — someone else's write already landed", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const unit = await withTenantContext(tenant.id, (tx) =>
      createUnit(tx, { propertyId: property.id, internalName: "U", publicName: "U", slug: "u" }),
    );

    // A first, unrelated write lands...
    await withTenantContext(tenant.id, (tx) => updateUnit(tx, { id: unit.id, status: "active" }));

    // ...then a second caller, still holding the *original* updatedAt, tries to write.
    await expect(
      withTenantContext(tenant.id, (tx) =>
        updateUnit(tx, { id: unit.id, status: "archived", expectedUpdatedAt: unit.updatedAt }),
      ),
    ).rejects.toThrow(UnitConflictError);

    // The conflicting write never landed.
    const stillActive = await withTenantContext(tenant.id, (tx) => getUnit(tx, unit.id));
    expect(stillActive?.status).toBe("active");
  });

  it("still throws UnitNotFoundError (not UnitConflictError) for a genuinely missing unit, even with expectedUpdatedAt set", async () => {
    const tenant = await createTenant();
    await expect(
      withTenantContext(tenant.id, (tx) =>
        updateUnit(tx, {
          id: "00000000-0000-0000-0000-000000000000",
          status: "active",
          expectedUpdatedAt: new Date(),
        }),
      ),
    ).rejects.toThrow(UnitNotFoundError);
  });
});
