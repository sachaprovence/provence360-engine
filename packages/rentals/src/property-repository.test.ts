import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { properties } from "@provence360/database";
import {
  createSite,
  createTenant,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { PropertyNotFoundError, SiteNotFoundError } from "./errors";
import {
  createProperty,
  deleteProperty,
  getProperty,
  listPropertiesForSite,
  updateProperty,
} from "./property-repository";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

async function siteFor(tenantId: string) {
  return createSite({ tenantId });
}

describe("createProperty", () => {
  it("creates a property attached to a site owned by the current tenant", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);

    const property = await withTenantContext(tenant.id, (tx) =>
      createProperty(tx, {
        siteId: site.id,
        internalName: "Domaine des Oliviers",
        publicName: "Domaine des Oliviers",
        slug: "domaine-des-oliviers",
        propertyType: "domaine",
      }),
    );

    expect(property.tenantId).toBe(tenant.id);
    expect(property.siteId).toBe(site.id);
    expect(property.status).toBe("draft");
  });

  it("refuses to attach a property to another tenant's site", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await siteFor(tenantB.id);

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        createProperty(tx, {
          siteId: siteB.id,
          internalName: "Stolen",
          publicName: "Stolen",
          slug: "stolen",
          propertyType: "villa",
        }),
      ),
    ).rejects.toThrow(SiteNotFoundError);
  });

  it("the composite FK rejects a forged tenant_id even bypassing the repository helper", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await siteFor(tenantB.id);

    // Simulates a hypothetical bug that forgot to derive tenantId from
    // context — properties_tenant_site_fk must reject this regardless of
    // what RLS alone would have done, since it targets (tenant_id, site_id)
    // as a pair, not just tenant_id in isolation.
    await expect(
      withTenantContext(tenantA.id, (tx) =>
        tx.insert(properties).values({
          tenantId: tenantA.id,
          siteId: siteB.id,
          internalName: "Forged",
          publicName: "Forged",
          slug: "forged",
          propertyType: "villa",
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("updateProperty / deleteProperty", () => {
  it("updates a property owned by the current tenant", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);
    const property = await withTenantContext(tenant.id, (tx) =>
      createProperty(tx, {
        siteId: site.id,
        internalName: "A",
        publicName: "A",
        slug: "a",
        propertyType: "villa",
      }),
    );

    const updated = await withTenantContext(tenant.id, (tx) =>
      updateProperty(tx, { id: property.id, status: "active" }),
    );
    expect(updated.status).toBe("active");
  });

  it("refuses to update another tenant's property", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await siteFor(tenantB.id);
    const propertyB = await withTenantContext(tenantB.id, (tx) =>
      createProperty(tx, {
        siteId: siteB.id,
        internalName: "B",
        publicName: "B",
        slug: "b",
        propertyType: "villa",
      }),
    );

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        updateProperty(tx, { id: propertyB.id, status: "archived" }),
      ),
    ).rejects.toThrow(PropertyNotFoundError);
  });

  it("refuses to delete another tenant's property, and does not delete it", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await siteFor(tenantB.id);
    const propertyB = await withTenantContext(tenantB.id, (tx) =>
      createProperty(tx, {
        siteId: siteB.id,
        internalName: "B",
        publicName: "B",
        slug: "b",
        propertyType: "villa",
      }),
    );

    await expect(
      withTenantContext(tenantA.id, (tx) => deleteProperty(tx, propertyB.id)),
    ).rejects.toThrow(PropertyNotFoundError);

    const stillThere = await withTenantContext(tenantB.id, (tx) => getProperty(tx, propertyB.id));
    expect(stillThere).not.toBeNull();
  });
});

describe("listPropertiesForSite", () => {
  it("only lists properties belonging to the current tenant's site", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteA = await siteFor(tenantA.id);
    const siteB = await siteFor(tenantB.id);

    await withTenantContext(tenantA.id, (tx) =>
      createProperty(tx, {
        siteId: siteA.id,
        internalName: "A1",
        publicName: "A1",
        slug: "a1",
        propertyType: "villa",
      }),
    );
    await withTenantContext(tenantB.id, (tx) =>
      createProperty(tx, {
        siteId: siteB.id,
        internalName: "B1",
        publicName: "B1",
        slug: "b1",
        propertyType: "villa",
      }),
    );

    const listA = await withTenantContext(tenantA.id, (tx) => listPropertiesForSite(tx, siteA.id));
    expect(listA.map((p) => p.slug)).toEqual(["a1"]);

    // Even asking about tenant B's real site id, from tenant A's context,
    // returns nothing — the site itself is invisible under RLS.
    const crossTenant = await withTenantContext(tenantA.id, (tx) =>
      listPropertiesForSite(tx, siteB.id),
    );
    expect(crossTenant).toEqual([]);
  });
});
