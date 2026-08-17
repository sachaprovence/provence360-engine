import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mediaAssets } from "@provence360/database";
import { getAdminDb } from "@provence360/database/admin";
import { createPage } from "@provence360/content";
import {
  createMediaAsset,
  createProperty,
  createSite,
  createTenant,
  createUnit,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { updateSiteNavigation } from "@provence360/sites";
import { assembleDraft } from "./draft-snapshot";
import { getPublishedRevision } from "./published-revision";
import { publishSite } from "./publish";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

async function seedHomePage(tenantId: string, siteId: string, content: unknown[] = []) {
  return withTenantContext(tenantId, (tx) =>
    createPage(tx, {
      siteId,
      slug: "",
      internalName: "Home",
      pageType: "home",
      status: "active",
      content,
    }),
  );
}

describe("Navigation references (publish-time resolution)", () => {
  it("a page of the correct site is accepted and resolved to its slug", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const home = await seedHomePage(tenant.id, site.id);
    const contact = await withTenantContext(tenant.id, (tx) =>
      createPage(tx, {
        siteId: site.id,
        slug: "contact",
        internalName: "Contact",
        status: "active",
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      updateSiteNavigation(tx, {
        id: site.id,
        navigation: {
          version: 1,
          items: [
            { id: "n1", label: { fr: "Accueil" }, target: { kind: "page", pageId: home.id } },
            { id: "n2", label: { fr: "Contact" }, target: { kind: "page", pageId: contact.id } },
          ],
        },
      }),
    );

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.snapshot.site.navigation.items.map((i) => i.target)).toEqual([
        { kind: "page", slug: "" },
        { kind: "page", slug: "contact" },
      ]);
    }
  });

  it("a pageId that doesn't exist at all is rejected at publish", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    await seedHomePage(tenant.id, site.id);
    await withTenantContext(tenant.id, (tx) =>
      updateSiteNavigation(tx, {
        id: site.id,
        navigation: {
          version: 1,
          items: [
            {
              id: "n1",
              label: { fr: "Nowhere" },
              target: { kind: "page", pageId: "01a00000-0000-7000-8000-00000000dead" },
            },
          ],
        },
      }),
    );

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "navigation_page_not_found")).toBe(true);
    }
  });

  it("a pageId belonging to a different Site (same tenant) is rejected", async () => {
    const tenant = await createTenant();
    const siteA = await createSite({ tenantId: tenant.id });
    const siteB = await createSite({ tenantId: tenant.id });
    await seedHomePage(tenant.id, siteA.id);
    const pageOnSiteB = await withTenantContext(tenant.id, (tx) =>
      createPage(tx, { siteId: siteB.id, slug: "other", internalName: "Other", status: "active" }),
    );
    await withTenantContext(tenant.id, (tx) =>
      updateSiteNavigation(tx, {
        id: siteA.id,
        navigation: {
          version: 1,
          items: [
            {
              id: "n1",
              label: { fr: "Wrong site" },
              target: { kind: "page", pageId: pageOnSiteB.id },
            },
          ],
        },
      }),
    );

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, siteA.id));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "navigation_page_not_found")).toBe(true);
    }
  });

  it("a pageId belonging to a different Tenant is rejected", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteA = await createSite({ tenantId: tenantA.id });
    const siteB = await createSite({ tenantId: tenantB.id });
    await seedHomePage(tenantA.id, siteA.id);
    const pageOnTenantB = await withTenantContext(tenantB.id, (tx) =>
      createPage(tx, { siteId: siteB.id, slug: "other", internalName: "Other", status: "active" }),
    );
    await withTenantContext(tenantA.id, (tx) =>
      updateSiteNavigation(tx, {
        id: siteA.id,
        navigation: {
          version: 1,
          items: [
            {
              id: "n1",
              label: { fr: "Cross tenant" },
              target: { kind: "page", pageId: pageOnTenantB.id },
            },
          ],
        },
      }),
    );

    const result = await withTenantContext(tenantA.id, (tx) => assembleDraft(tx, siteA.id));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "navigation_page_not_found")).toBe(true);
    }
  });

  it("a pageId naming a draft (unpublished) Page is rejected as a publishable destination", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    await seedHomePage(tenant.id, site.id);
    const draftPage = await withTenantContext(tenant.id, (tx) =>
      createPage(tx, { siteId: site.id, slug: "wip", internalName: "WIP", status: "draft" }),
    );
    await withTenantContext(tenant.id, (tx) =>
      updateSiteNavigation(tx, {
        id: site.id,
        navigation: {
          version: 1,
          items: [
            { id: "n1", label: { fr: "WIP" }, target: { kind: "page", pageId: draftPage.id } },
          ],
        },
      }),
    );

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "navigation_page_not_found")).toBe(true);
    }
  });
});

describe("Immutability: navigation and slug changes never retroactively affect a published Revision", () => {
  it("publish N, then change the Draft's navigation — N's navigation stays exactly as it was", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const home = await seedHomePage(tenant.id, site.id);
    await withTenantContext(tenant.id, (tx) =>
      updateSiteNavigation(tx, {
        id: site.id,
        navigation: {
          version: 1,
          items: [
            { id: "n1", label: { fr: "Accueil" }, target: { kind: "page", pageId: home.id } },
          ],
        },
      }),
    );
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    await withTenantContext(tenant.id, (tx) =>
      updateSiteNavigation(tx, { id: site.id, navigation: { version: 1, items: [] } }),
    );

    const published = await withTenantContext(tenant.id, (tx) => getPublishedRevision(tx, site.id));
    expect(published?.snapshot.site.navigation.items).toHaveLength(1);
  });

  it("publish N, then rename the target Page's slug in the Draft — N keeps its originally-resolved destination", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const home = await seedHomePage(tenant.id, site.id);
    const contact = await withTenantContext(tenant.id, (tx) =>
      createPage(tx, {
        siteId: site.id,
        slug: "contact",
        internalName: "Contact",
        status: "active",
      }),
    );
    await withTenantContext(tenant.id, (tx) =>
      updateSiteNavigation(tx, {
        id: site.id,
        navigation: {
          version: 1,
          items: [
            { id: "n1", label: { fr: "Contact" }, target: { kind: "page", pageId: contact.id } },
          ],
        },
      }),
    );
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    // Rename the Page's slug in the Draft — but `slug` isn't part of
    // `updatePageMeta`'s writable fields (it's immutable by design in this
    // codebase), so simulate the same "the Draft's routing changed after
    // publish" scenario the invariant cares about via the admin connection,
    // exactly like `draft-snapshot.test.ts`'s own "simulate an old
    // registry" pattern.
    const { pages } = await import("@provence360/database");
    await getAdminDb().update(pages).set({ slug: "contact-us" }).where(eq(pages.id, contact.id));
    void home;

    const published = await withTenantContext(tenant.id, (tx) => getPublishedRevision(tx, site.id));
    expect(published?.snapshot.site.navigation.items[0]?.target).toEqual({
      kind: "page",
      slug: "contact",
    });
  });
});

describe("Media: extraction, resolution, freezing", () => {
  it("an existing tenant-owned media asset is accepted and frozen into the snapshot's manifest", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const asset = await createMediaAsset({ tenantId: tenant.id, altText: "A villa" });
    await seedHomePage(tenant.id, site.id, [
      {
        id: "b1",
        type: "hero",
        version: 1,
        props: { headline: { fr: "H" }, backgroundMediaId: asset.id },
      },
    ]);

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.snapshot.media).toEqual([
        expect.objectContaining({ id: asset.id, altText: "A villa" }),
      ]);
    }
  });

  it("a missing media reference is rejected at publish", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    await seedHomePage(tenant.id, site.id, [
      {
        id: "b1",
        type: "hero",
        version: 1,
        props: { headline: { fr: "H" }, backgroundMediaId: "01a00000-0000-7000-8000-00000000feed" },
      },
    ]);

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "media_reference_missing")).toBe(true);
    }
  });

  it("a cross-tenant media reference is rejected at publish", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const site = await createSite({ tenantId: tenantA.id });
    const otherTenantsAsset = await createMediaAsset({ tenantId: tenantB.id });
    await seedHomePage(tenantA.id, site.id, [
      {
        id: "b1",
        type: "hero",
        version: 1,
        props: { headline: { fr: "H" }, backgroundMediaId: otherTenantsAsset.id },
      },
    ]);

    const result = await withTenantContext(tenantA.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "media_reference_missing")).toBe(true);
    }
  });

  it("the same media id referenced by multiple blocks is deduplicated in the frozen manifest", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const asset = await createMediaAsset({ tenantId: tenant.id });
    await seedHomePage(tenant.id, site.id, [
      {
        id: "b1",
        type: "hero",
        version: 1,
        props: { headline: { fr: "H" }, backgroundMediaId: asset.id },
      },
      { id: "b2", type: "gallery", version: 1, props: { mediaAssetIds: [asset.id] } },
    ]);

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.snapshot.media?.filter((m) => m.id === asset.id)).toHaveLength(1);
    }
  });

  it("a Page's SEO ogImageMediaId is included in the frozen media manifest", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const asset = await createMediaAsset({ tenantId: tenant.id });
    await withTenantContext(tenant.id, (tx) =>
      createPage(tx, {
        siteId: site.id,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        seo: { ogImageMediaId: asset.id },
      }),
    );

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.snapshot.media?.some((m) => m.id === asset.id)).toBe(true);
    }
  });

  it("a media asset never referenced by any block/SEO is not included in the manifest (minimal manifest)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const used = await createMediaAsset({ tenantId: tenant.id });
    const unused = await createMediaAsset({ tenantId: tenant.id });
    await seedHomePage(tenant.id, site.id, [
      {
        id: "b1",
        type: "hero",
        version: 1,
        props: { headline: { fr: "H" }, backgroundMediaId: used.id },
      },
    ]);
    void unused;

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.snapshot.media?.map((m) => m.id)).toEqual([used.id]);
    }
  });

  it("modifying a MediaAsset's own metadata after publish does not change an already-published Revision (Invariant: presentation frozen)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const asset = await createMediaAsset({ tenantId: tenant.id, altText: "Original alt text" });
    await seedHomePage(tenant.id, site.id, [
      {
        id: "b1",
        type: "hero",
        version: 1,
        props: { headline: { fr: "H" }, backgroundMediaId: asset.id },
      },
    ]);
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    // The MediaAsset row itself changes after the fact (the same
    // admin-connection pattern used everywhere else in this codebase to
    // simulate a write outside the current test's own tenant-scoped flow).
    await getAdminDb()
      .update(mediaAssets)
      .set({ altText: "Edited after publish" })
      .where(eq(mediaAssets.id, asset.id));

    const published = await withTenantContext(tenant.id, (tx) => getPublishedRevision(tx, site.id));
    expect(published?.snapshot.media?.find((m) => m.id === asset.id)?.altText).toBe(
      "Original alt text",
    );
  });
});

describe("Domain references: publish-time existence/tenant check (business data stays live, never frozen)", () => {
  it("a valid, tenant-owned propertyId is accepted", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    await seedHomePage(tenant.id, site.id, [
      { id: "b1", type: "property-summary", version: 1, props: { propertyId: property.id } },
    ]);

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(true);
  });

  it("a nonexistent propertyId is rejected at publish", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    await seedHomePage(tenant.id, site.id, [
      {
        id: "b1",
        type: "property-summary",
        version: 1,
        props: { propertyId: "01a00000-0000-7000-8000-00000000dead" },
      },
    ]);

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "domain_reference_missing")).toBe(true);
    }
  });

  it("a cross-tenant propertyId is rejected at publish", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteA = await createSite({ tenantId: tenantA.id });
    const siteB = await createSite({ tenantId: tenantB.id });
    const propertyB = await createProperty({ tenantId: tenantB.id, siteId: siteB.id });
    await seedHomePage(tenantA.id, siteA.id, [
      { id: "b1", type: "property-summary", version: 1, props: { propertyId: propertyB.id } },
    ]);

    const result = await withTenantContext(tenantA.id, (tx) => assembleDraft(tx, siteA.id));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "domain_reference_missing")).toBe(true);
    }
  });

  it("a cross-tenant unitId (amenities block) is rejected at publish", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteA = await createSite({ tenantId: tenantA.id });
    const siteB = await createSite({ tenantId: tenantB.id });
    const propertyB = await createProperty({ tenantId: tenantB.id, siteId: siteB.id });
    const unitB = await createUnit({ tenantId: tenantB.id, propertyId: propertyB.id });
    await seedHomePage(tenantA.id, siteA.id, [
      { id: "b1", type: "amenities", version: 1, props: { unitId: unitB.id } },
    ]);

    const result = await withTenantContext(tenantA.id, (tx) => assembleDraft(tx, siteA.id));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "domain_reference_missing")).toBe(true);
    }
  });

  it("v0.6: a draft (not yet active) Property is rejected at publish with domain_reference_not_active, distinct from domain_reference_missing", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const draftProperty = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      status: "draft",
    });
    await seedHomePage(tenant.id, site.id, [
      { id: "b1", type: "property-summary", version: 1, props: { propertyId: draftProperty.id } },
    ]);

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "domain_reference_not_active")).toBe(true);
      expect(result.issues.some((i) => i.code === "domain_reference_missing")).toBe(false);
    }
  });

  it("v0.6: an archived Property is likewise rejected at publish", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const archivedProperty = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      status: "archived",
    });
    await seedHomePage(tenant.id, site.id, [
      {
        id: "b1",
        type: "property-summary",
        version: 1,
        props: { propertyId: archivedProperty.id },
      },
    ]);

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "domain_reference_not_active")).toBe(true);
    }
  });

  it("v0.6: a draft Unit (amenities block) is likewise rejected at publish", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const draftUnit = await createUnit({
      tenantId: tenant.id,
      propertyId: property.id,
      status: "draft",
    });
    await seedHomePage(tenant.id, site.id, [
      { id: "b1", type: "amenities", version: 1, props: { unitId: draftUnit.id } },
    ]);

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "domain_reference_not_active")).toBe(true);
    }
  });

  it("v0.6: a not_bookable_separately Unit is accepted (public, just not independently bookable)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const unit = await createUnit({
      tenantId: tenant.id,
      propertyId: property.id,
      status: "not_bookable_separately",
    });
    await seedHomePage(tenant.id, site.id, [
      { id: "b1", type: "amenities", version: 1, props: { unitId: unit.id } },
    ]);

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(true);
  });

  it("v0.6: a property-scoped amenities block references its Property, not a Unit", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    await seedHomePage(tenant.id, site.id, [
      { id: "b1", type: "amenities", version: 1, props: { propertyId: property.id } },
    ]);

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(true);
  });

  it("does not freeze the Property's own business fields into the snapshot — only the reference (Presentation frozen, Business live)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const property = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      publicName: "Villa X",
    });
    await seedHomePage(tenant.id, site.id, [
      { id: "b1", type: "property-summary", version: 1, props: { propertyId: property.id } },
    ]);

    const result = await withTenantContext(tenant.id, (tx) => assembleDraft(tx, site.id));
    expect(result.valid).toBe(true);
    if (result.valid) {
      const snapshotJson = JSON.stringify(result.snapshot);
      expect(snapshotJson).not.toContain("Villa X");
    }
  });
});
