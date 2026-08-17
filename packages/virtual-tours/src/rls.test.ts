import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { virtualTours } from "@provence360/database";
import {
  createProperty,
  createSite,
  createTenant,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";

// Real-Postgres RLS tests for `virtual_tours` — deliberately bypassing
// `packages/virtual-tours`' own repository functions, which already
// re-derive everything through a tenant-scoped read. The point here is to
// prove the database-level boundary itself, independent of any application
// code ever getting it right — same pattern as packages/rentals' and
// packages/publishing's own rls.test.ts files.

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

describe("RLS: virtual_tours", () => {
  it("tenant A cannot read tenant B's virtual tours, even by guessing the exact row id", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const propertyB = await propertyFor(tenantB.id);
    const { getAdminDb } = await import("@provence360/database/admin");
    const [rowB] = await getAdminDb()
      .insert(virtualTours)
      .values({
        tenantId: tenantB.id,
        propertyId: propertyB.id,
        provider: "matterport",
        providerAssetId: "abc12345678",
        internalName: "B",
        publicName: "B",
      })
      .returning();
    if (!rowB) throw new Error("Failed to create test virtual tour");

    const rows = await withTenantContext(tenantA.id, (tx) =>
      tx.select().from(virtualTours).where(eq(virtualTours.id, rowB.id)),
    );
    expect(rows).toHaveLength(0);
  });

  it("a query with no tenant context at all sees nothing (fail closed)", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);
    const { getAdminDb } = await import("@provence360/database/admin");
    await getAdminDb().insert(virtualTours).values({
      tenantId: tenant.id,
      propertyId: property.id,
      provider: "matterport",
      providerAssetId: "abc12345678",
      internalName: "T",
      publicName: "T",
    });

    const { getAppDb } = await import("@provence360/database/client-app");
    const rows = await getAppDb().select().from(virtualTours);
    expect(rows).toHaveLength(0);
  });

  it("provence360_app cannot INSERT a row claiming a different tenant's tenant_id than its own context (withCheck)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const propertyB = await propertyFor(tenantB.id);

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        tx.insert(virtualTours).values({
          tenantId: tenantB.id,
          propertyId: propertyB.id,
          provider: "matterport",
          providerAssetId: "abc12345678",
          internalName: "Forged",
          publicName: "Forged",
        }),
      ),
    ).rejects.toThrow();
  });

  it("the composite FK rejects a forged tenant_id/property_id pair even bypassing RLS's own INSERT check", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const propertyB = await propertyFor(tenantB.id);

    // tenant_id matches the acting tenant (passes withCheck) but
    // property_id belongs to a different tenant entirely — the composite
    // FK (tenant_id, property_id) -> properties(tenant_id, id) must still
    // reject this.
    await expect(
      withTenantContext(tenantA.id, (tx) =>
        tx.insert(virtualTours).values({
          tenantId: tenantA.id,
          propertyId: propertyB.id,
          provider: "matterport",
          providerAssetId: "abc12345678",
          internalName: "Forged",
          publicName: "Forged",
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects an empty providerAssetId (CHECK constraint)", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);

    await expect(
      withTenantContext(tenant.id, (tx) =>
        tx.insert(virtualTours).values({
          tenantId: tenant.id,
          propertyId: property.id,
          provider: "matterport",
          providerAssetId: "",
          internalName: "Empty",
          publicName: "Empty",
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a negative ordering value (CHECK constraint)", async () => {
    const tenant = await createTenant();
    const property = await propertyFor(tenant.id);

    await expect(
      withTenantContext(tenant.id, (tx) =>
        tx.insert(virtualTours).values({
          tenantId: tenant.id,
          propertyId: property.id,
          provider: "matterport",
          providerAssetId: "abc12345678",
          internalName: "Negative",
          publicName: "Negative",
          ordering: -1,
        }),
      ),
    ).rejects.toThrow();
  });
});
