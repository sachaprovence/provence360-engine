import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sites } from "@provence360/database";
import { DEFAULT_SITE_BRANDING, resolveSiteBranding } from "@provence360/themes";
import {
  createTenant,
  createTheme,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { SiteConflictError, SiteNotFoundError } from "./site-repository";
import {
  createSite,
  getSiteBySlug,
  listSites,
  updateSiteBranding,
  updateSiteNavigation,
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

  it("with a stale expectedUpdatedAt throws SiteConflictError and leaves the row unchanged (Invariant H)", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );
    const staleUpdatedAt = site.updatedAt;

    await withTenantContext(tenant.id, (tx) =>
      updateSiteSettings(tx, { id: site.id, publicName: "Changed by someone else" }),
    );

    await expect(
      withTenantContext(tenant.id, (tx) =>
        updateSiteSettings(tx, {
          id: site.id,
          publicName: "Stale write",
          expectedUpdatedAt: staleUpdatedAt,
        }),
      ),
    ).rejects.toThrow(SiteConflictError);

    const [reloaded] = await withTenantContext(tenant.id, (tx) =>
      tx.select().from(sites).where(eq(sites.id, site.id)),
    );
    expect(reloaded?.publicName).toBe("Changed by someone else");
  });

  it("with the correct expectedUpdatedAt (read right after creation, Postgres-native precision) succeeds", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );

    const updated = await withTenantContext(tenant.id, (tx) =>
      updateSiteSettings(tx, {
        id: site.id,
        publicName: "Fresh write",
        expectedUpdatedAt: site.updatedAt,
      }),
    );
    expect(updated.publicName).toBe("Fresh write");
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

// v0.8 — Site Theme, Branding & Design System Kernel (see
// docs/adr/0021-site-theme-branding-design-system.md). Mirrors
// `updateSiteTheme`'s own test shape exactly — same isolation discipline,
// same "reads back what was written," "two sites diverge independently,"
// "rejects a structurally invalid override," "cross-tenant write is
// refused" matrix, applied to the second, additive branding layer.
describe("updateSiteBranding", () => {
  it("a freshly created site resolves to DEFAULT_SITE_BRANDING (backward compatibility, section 11)", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );
    expect(resolveSiteBranding(site.branding)).toEqual(DEFAULT_SITE_BRANDING);
  });

  it("sets branding overrides, readable back and resolved on top of the default", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );

    const updated = await withTenantContext(tenant.id, (tx) =>
      updateSiteBranding(tx, {
        id: site.id,
        branding: { version: 1, colors: { primary: "#ff0000" } },
      }),
    );
    const resolved = resolveSiteBranding(updated.branding);
    expect(resolved.colors.primary).toBe("#ff0000");
    expect(resolved.colors.background).toBe(DEFAULT_SITE_BRANDING.colors.background);
  });

  it("two sites can override branding differently, independently", async () => {
    const tenant = await createTenant();
    const siteA = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "a", name: "A" }),
    );
    const siteB = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "b", name: "B" }),
    );

    await withTenantContext(tenant.id, (tx) =>
      updateSiteBranding(tx, {
        id: siteA.id,
        branding: { version: 1, brand: { name: "Villa A" } },
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      updateSiteBranding(tx, {
        id: siteB.id,
        branding: { version: 1, brand: { name: "Villa B" } },
      }),
    );

    const [a] = await withTenantContext(tenant.id, (tx) =>
      tx.select().from(sites).where(eq(sites.id, siteA.id)),
    );
    const [b] = await withTenantContext(tenant.id, (tx) =>
      tx.select().from(sites).where(eq(sites.id, siteB.id)),
    );
    expect(resolveSiteBranding(a?.branding).brand.name).toBe("Villa A");
    expect(resolveSiteBranding(b?.branding).brand.name).toBe("Villa B");
  });

  it("rejects a non-hex color value", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );

    await expect(
      withTenantContext(tenant.id, (tx) =>
        updateSiteBranding(tx, {
          id: site.id,
          branding: { version: 1, colors: { primary: "javascript:alert(1)" } },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects an override key outside the closed shape", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );

    await expect(
      withTenantContext(tenant.id, (tx) =>
        updateSiteBranding(tx, {
          id: site.id,
          branding: { version: 1, colors: { wildcard: "#ff0000" } },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects an unrecognized font token", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );

    await expect(
      withTenantContext(tenant.id, (tx) =>
        updateSiteBranding(tx, {
          id: site.id,
          branding: { version: 1, typography: { heading: "comic-sans" } },
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses to change another tenant's site branding", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await withTenantContext(tenantB.id, (tx) =>
      createSite(tx, { slug: "b", name: "B" }),
    );

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        updateSiteBranding(tx, { id: siteB.id, branding: { version: 1 } }),
      ),
    ).rejects.toThrow(SiteNotFoundError);
  });

  it("RLS itself (not just updateSiteBranding's own WHERE clause) blocks a cross-tenant branding write — bypasses the repository helper entirely", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await withTenantContext(tenantB.id, (tx) =>
      createSite(tx, { slug: "b", name: "B" }),
    );

    // A raw Drizzle `.update()` under Tenant A's context, targeting Tenant
    // B's site by id only — no `tenantId` in the WHERE clause at all. If
    // RLS weren't the real backstop, this would silently succeed.
    const affected = await withTenantContext(tenantA.id, (tx) =>
      tx
        .update(sites)
        .set({ branding: { version: 1, brand: { name: "Hijacked" } } })
        .where(eq(sites.id, siteB.id))
        .returning(),
    );
    expect(affected).toHaveLength(0);

    const [stillB] = await withTenantContext(tenantB.id, (tx) =>
      tx.select().from(sites).where(eq(sites.id, siteB.id)),
    );
    expect(resolveSiteBranding(stillB?.branding).brand.name).toBeUndefined();
  });
});

describe("updateSiteNavigation (structural validation only — see packages/publishing for referential validation)", () => {
  it("accepts and stores a well-formed navigation", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );
    const pageId = "01a00000-0000-7000-8000-000000000001";

    const updated = await withTenantContext(tenant.id, (tx) =>
      updateSiteNavigation(tx, {
        id: site.id,
        navigation: {
          version: 1,
          items: [{ id: "n1", label: { fr: "Accueil" }, target: { kind: "page", pageId } }],
        },
      }),
    );

    expect((updated.navigation as { items: unknown[] }).items).toHaveLength(1);
  });

  it("rejects a malformed navigation before it ever reaches the database (structural validation, not referential)", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );

    await expect(
      withTenantContext(tenant.id, (tx) =>
        updateSiteNavigation(tx, {
          id: site.id,
          navigation: { version: 1, items: [{ id: "n1", label: {}, target: { kind: "bogus" } }] },
        }),
      ),
    ).rejects.toThrow();

    // The row is untouched — a rejected structural validation never partially writes.
    const [reloaded] = await withTenantContext(tenant.id, (tx) =>
      tx.select().from(sites).where(eq(sites.id, site.id)),
    );
    expect(reloaded?.navigation).toEqual([]);
  });

  it("accepts a navigation referencing a pageId that doesn't (yet) exist — that's a referential check, deferred to publish time", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );
    const nonExistentPageId = "01a00000-0000-7000-8000-00000000dead";

    const updated = await withTenantContext(tenant.id, (tx) =>
      updateSiteNavigation(tx, {
        id: site.id,
        navigation: {
          version: 1,
          items: [
            {
              id: "n1",
              label: { fr: "Nowhere yet" },
              target: { kind: "page", pageId: nonExistentPageId },
            },
          ],
        },
      }),
    );
    expect((updated.navigation as { items: unknown[] }).items).toHaveLength(1);
  });

  it("refuses to change another tenant's site navigation", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await withTenantContext(tenantB.id, (tx) =>
      createSite(tx, { slug: "b", name: "B" }),
    );

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        updateSiteNavigation(tx, { id: siteB.id, navigation: { version: 1, items: [] } }),
      ),
    ).rejects.toThrow(SiteNotFoundError);
  });

  it("with a stale expectedUpdatedAt throws SiteConflictError and leaves the row unchanged", async () => {
    const tenant = await createTenant();
    const site = await withTenantContext(tenant.id, (tx) =>
      createSite(tx, { slug: "s", name: "S" }),
    );
    const staleUpdatedAt = site.updatedAt;

    await withTenantContext(tenant.id, (tx) =>
      updateSiteNavigation(tx, { id: site.id, navigation: { version: 1, items: [] } }),
    );

    await expect(
      withTenantContext(tenant.id, (tx) =>
        updateSiteNavigation(tx, {
          id: site.id,
          navigation: {
            version: 1,
            items: [
              { id: "stale", label: { fr: "Stale" }, target: { kind: "external", href: "/x" } },
            ],
          },
          expectedUpdatedAt: staleUpdatedAt,
        }),
      ),
    ).rejects.toThrow(SiteConflictError);
  });
});
