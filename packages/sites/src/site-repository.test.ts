import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sites } from "@provence360/database";
import { createTenant, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { createSite, getSiteBySlug, listSites } from "./site-repository";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("createSite / getSiteBySlug / listSites", () => {
  it("creates a site under the current tenant and can read it back", async () => {
    const tenant = await createTenant();

    const created = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "villas-cassis", name: "Villas Cassis" }),
    );
    expect(created.tenantId).toBe(tenant.id);

    const found = await withTenantContext(tenant.id, (tx) => getSiteBySlug(tx, "villas-cassis"));
    expect(found?.id).toBe(created.id);
  });

  it("does not let a tenant read a site created by another tenant, by slug", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    await withTenantContext(tenantA.id, (tx) =>
      createSite(tx, { slug: "shared-slug", name: "A's site" }),
    );

    const found = await withTenantContext(tenantB.id, (tx) => getSiteBySlug(tx, "shared-slug"));
    expect(found).toBeNull();
  });

  it("scopes listSites to the current tenant only", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    await withTenantContext(tenantA.id, (tx) => createSite(tx, { slug: "a-1", name: "A1" }));
    await withTenantContext(tenantA.id, (tx) => createSite(tx, { slug: "a-2", name: "A2" }));
    await withTenantContext(tenantB.id, (tx) => createSite(tx, { slug: "b-1", name: "B1" }));

    const listA = await withTenantContext(tenantA.id, (tx) => listSites(tx));
    const listB = await withTenantContext(tenantB.id, (tx) => listSites(tx));

    expect(listA.map((s) => s.slug).sort()).toEqual(["a-1", "a-2"]);
    expect(listB.map((s) => s.slug)).toEqual(["b-1"]);
  });

  it("two tenants may reuse the same slug independently", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    await withTenantContext(tenantA.id, (tx) => createSite(tx, { slug: "same-slug", name: "A" }));
    await withTenantContext(tenantB.id, (tx) => createSite(tx, { slug: "same-slug", name: "B" }));

    const foundA = await withTenantContext(tenantA.id, (tx) => getSiteBySlug(tx, "same-slug"));
    const foundB = await withTenantContext(tenantB.id, (tx) => getSiteBySlug(tx, "same-slug"));

    expect(foundA?.name).toBe("A");
    expect(foundB?.name).toBe("B");
  });

  it("RLS rejects an insert whose tenant_id doesn't match the active context, even bypassing the repository helper", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    // Simulates a hypothetical bug in a repository function that forgot to
    // derive tenantId from the context and used the wrong id instead.
    // withCheck on tenant_isolation_sites must reject this regardless.
    await expect(
      withTenantContext(tenantA.id, (tx) =>
        tx.insert(sites).values({ tenantId: tenantB.id, slug: "forged", name: "Forged" }),
      ),
    ).rejects.toThrow();
  });
});
