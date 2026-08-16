import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sites } from "@provence360/database";
import {
  createTenant,
  createTheme,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { SiteNotFoundError } from "./site-repository";
import {
  createSite,
  getSiteBySlug,
  listSites,
  updateSiteSettings,
  updateSiteTheme,
} from "./site-repository";

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

describe("updateSiteSettings", () => {
  it("updates a site's v0.3 settings fields", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );

    const updated = await withTenantContext(tenant.id, (tx) =>
      updateSiteSettings(tx, {
        id: site.id,
        publicName: "Villa des Oliviers",
        timezone: "Europe/Paris",
        defaultLocale: "fr",
        enabledLocales: ["fr", "en"],
        contactEmail: "contact@villa.test",
      }),
    );

    expect(updated.publicName).toBe("Villa des Oliviers");
    expect(updated.enabledLocales).toEqual(["fr", "en"]);
  });

  it("refuses to update another tenant's site", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await withTenantContext(tenantB.id, (tx) =>
      createSite(tx, { slug: "b", name: "B" }),
    );

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        updateSiteSettings(tx, { id: siteB.id, publicName: "Hacked" }),
      ),
    ).rejects.toThrow(SiteNotFoundError);
  });
});

describe("updateSiteTheme", () => {
  it("sets a site's base theme", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );
    const theme = await createTheme({ key: "provence" });

    const updated = await withTenantContext(tenant.id, (tx) =>
      updateSiteTheme(tx, { id: site.id, themeId: theme.id }),
    );
    expect(updated.themeId).toBe(theme.id);
  });

  it("two sites can override the same base theme differently", async () => {
    const tenant = await createTenant();
    const theme = await createTheme({ key: "provence" });
    const siteA = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "a", name: "A" }),
    );
    const siteB = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "b", name: "B" }),
    );

    await withTenantContext(tenant.id, (tx) =>
      updateSiteTheme(tx, {
        id: siteA.id,
        themeId: theme.id,
        themeOverrides: { "color.primary": "olive" },
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      updateSiteTheme(tx, {
        id: siteB.id,
        themeId: theme.id,
        themeOverrides: { "color.primary": "blue" },
      }),
    );

    const [a] = await withTenantContext(tenant.id, (tx) =>
      tx.select().from(sites).where(eq(sites.id, siteA.id)),
    );
    const [b] = await withTenantContext(tenant.id, (tx) =>
      tx.select().from(sites).where(eq(sites.id, siteB.id)),
    );
    expect((a?.themeOverrides as Record<string, string>)["color.primary"]).toBe("olive");
    expect((b?.themeOverrides as Record<string, string>)["color.primary"]).toBe("blue");
  });

  it("rejects an override key outside the closed token catalog", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );

    await expect(
      withTenantContext(tenant.id, (tx) =>
        updateSiteTheme(tx, { id: site.id, themeOverrides: { "color.wildcard": "red" } as never }),
      ),
    ).rejects.toThrow();
  });

  it("refuses to change another tenant's site theme", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await withTenantContext(tenantB.id, (tx) =>
      createSite(tx, { slug: "b", name: "B" }),
    );
    const theme = await createTheme({ key: "provence" });

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        updateSiteTheme(tx, { id: siteB.id, themeId: theme.id }),
      ),
    ).rejects.toThrow(SiteNotFoundError);
  });
});
