import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPage } from "@provence360/content";
import { DEFAULT_SITE_BRANDING } from "@provence360/themes";
import {
  createMediaAsset,
  createSite,
  createTenant,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { assembleDraft } from "./draft-snapshot";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("assembleDraft", () => {
  it("is invalid when the site has no active home page", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "missing_home_page")).toBe(true);
    }
  });

  it("is valid and snapshots only active pages, ordered by slug, once a home page exists", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    await withTenantContext(tenant.id, (tx) =>
      createPage(tx, {
        siteId: site.id,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        content: [{ id: "b1", type: "text", version: 1, props: { body: { fr: "Bienvenue" } } }],
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      createPage(tx, {
        siteId: site.id,
        slug: "contact",
        internalName: "Contact",
        status: "active",
      }),
    );
    // A draft page must never leak into a published snapshot.
    await withTenantContext(tenant.id, (tx) =>
      createPage(tx, {
        siteId: site.id,
        slug: "hidden",
        internalName: "Hidden",
        status: "draft",
      }),
    );

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.snapshot.pages.map((p) => p.slug)).toEqual(["", "contact"]);
      expect(result.snapshot.pages[0]?.content).toHaveLength(1);
    }
  });

  it("reports invalid content as a structured issue instead of throwing", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    await withTenantContext(tenant.id, (tx) =>
      createPage(tx, {
        siteId: site.id,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
      }),
    );
    const badPage = await withTenantContext(tenant.id, (tx) =>
      createPage(tx, { siteId: site.id, slug: "broken", internalName: "Broken", status: "active" }),
    );
    // Simulate content that was valid at write time but no longer parses
    // (e.g. a since-removed block type) — bypass the write-time validator
    // via the admin connection, the same way an old registry version could
    // leave content behind that a newer registry can no longer parse.
    const { getAdminDb } = await import("@provence360/database/admin");
    const { pages } = await import("@provence360/database");
    const { eq } = await import("drizzle-orm");
    await getAdminDb()
      .update(pages)
      .set({ content: [{ id: "x", type: "no-such-block", version: 1, props: {} }] })
      .where(eq(pages.id, badPage.id));

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.issues.some((i) => i.code === "invalid_page_content" && i.pageId === badPage.id),
      ).toBe(true);
    }
  });

  it("throws SiteNotFoundError for a site belonging to another tenant", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await createSite({ tenantId: tenantB.id });

    const { SiteNotFoundError } = await import("./errors");
    await expect(
      withTenantContext(tenantA.id, (tx) => assembleDraft(tx, siteB.id)),
    ).rejects.toThrow(SiteNotFoundError);
  });

  // v0.8 — Site Theme, Branding & Design System Kernel (see
  // docs/adr/0021-site-theme-branding-design-system.md). Same "one pass
  // both validates and freezes" contract `theme` already has, applied to
  // the second, additive branding layer.
  describe("branding", () => {
    async function homePageSite(tenantId: string) {
      const site = await createSite({ tenantId });
      await withTenantContext(tenantId, (tx) =>
        createPage(tx, {
          siteId: site.id,
          slug: "",
          internalName: "Home",
          pageType: "home",
          status: "active",
        }),
      );
      return site;
    }

    it("freezes DEFAULT_SITE_BRANDING for a site that never configured branding", async () => {
      const tenant = await createTenant();
      const site = await homePageSite(tenant.id);

      const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.snapshot.branding).toEqual(DEFAULT_SITE_BRANDING);
      }
    });

    it("freezes the site's own branding overrides, resolved on top of the default", async () => {
      const tenant = await createTenant();
      const site = await homePageSite(tenant.id);
      const { getAdminDb } = await import("@provence360/database/admin");
      const { sites } = await import("@provence360/database");
      const { eq } = await import("drizzle-orm");
      await getAdminDb()
        .update(sites)
        .set({ branding: { version: 1, colors: { primary: "#ff0000" } } })
        .where(eq(sites.id, site.id));

      const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.snapshot.branding.colors.primary).toBe("#ff0000");
        expect(result.snapshot.branding.colors.background).toBe(
          DEFAULT_SITE_BRANDING.colors.background,
        );
      }
    });

    it("resolves a logo media reference into the frozen manifest, deduplicated with content-block media", async () => {
      const tenant = await createTenant();
      const site = await homePageSite(tenant.id);
      const asset = await createMediaAsset({ tenantId: tenant.id, storageKey: "brand/logo.png" });
      const { getAdminDb } = await import("@provence360/database/admin");
      const { sites } = await import("@provence360/database");
      const { eq } = await import("drizzle-orm");
      await getAdminDb()
        .update(sites)
        .set({ branding: { version: 1, brand: { logo: { mediaId: asset.id } } } })
        .where(eq(sites.id, site.id));

      const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.snapshot.branding.brand.logo).toEqual({ mediaId: asset.id });
        expect(result.snapshot.media?.some((m) => m.id === asset.id)).toBe(true);
      }
    });

    it("silently drops a missing/stale logo reference — never publish-blocking (a logo is chrome, not content)", async () => {
      const tenant = await createTenant();
      const site = await homePageSite(tenant.id);
      const staleId = "01a00000-0000-7000-8000-00000000dead";
      const { getAdminDb } = await import("@provence360/database/admin");
      const { sites } = await import("@provence360/database");
      const { eq } = await import("drizzle-orm");
      await getAdminDb()
        .update(sites)
        .set({ branding: { version: 1, brand: { logo: { mediaId: staleId } } } })
        .where(eq(sites.id, site.id));

      const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.snapshot.branding.brand.logo).toBeUndefined();
      }
    });

    it("blocks publishing on a structurally invalid stored branding value (invalid_branding)", async () => {
      const tenant = await createTenant();
      const site = await homePageSite(tenant.id);
      const { getAdminDb } = await import("@provence360/database/admin");
      const { sites } = await import("@provence360/database");
      const { eq } = await import("drizzle-orm");
      await getAdminDb()
        .update(sites)
        .set({ branding: { version: 1, colors: { primary: "not-a-hex-color" } } })
        .where(eq(sites.id, site.id));

      const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.issues.some((i) => i.code === "invalid_branding")).toBe(true);
      }
    });
  });
});
