import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppTx } from "@provence360/database";
import { generateBlockInstanceId } from "@provence360/content";
import { resolveTheme } from "@provence360/themes";
import {
  attachPropertyAmenity,
  attachUnitAmenity,
  createAmenity,
  createMediaAsset,
  createProperty,
  createSite,
  createSleepingArrangement,
  createTenant,
  createUnit,
  createVirtualTour,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { getAdminDb } from "@provence360/database/admin";
import { mediaAssets, properties, virtualTours } from "@provence360/database";
import { eq } from "drizzle-orm";
import { renderBlocks } from "./index";
import type { FrozenMediaDescriptor, RenderContext } from "./render-context";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

const OVERRIDE_TOKENS = resolveTheme(undefined, { "color.surface": "#123456" });

function contextFor(tenantId: string, siteId: string, tx: AppTx): RenderContext {
  return {
    tx,
    tenantId,
    siteId,
    locale: "fr",
    defaultLocale: "fr",
    tokens: OVERRIDE_TOKENS,
  };
}

describe("renderBlocks", () => {
  it("renders content blocks in order, with theme tokens applied", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "hero",
        version: 1,
        props: { headline: { fr: "Bienvenue" } },
      },
      {
        id: generateBlockInstanceId(),
        type: "text",
        version: 1,
        props: { body: { fr: "Un texte." } },
      },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    const heroIndex = html.indexOf("Bienvenue");
    const textIndex = html.indexOf("Un texte.");
    expect(heroIndex).toBeGreaterThan(-1);
    expect(textIndex).toBeGreaterThan(heroIndex);
    expect(html).toContain("#123456");
  });

  it("injects real Property data into a PropertySummary block instead of duplicating it in props", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      publicName: "Villa des Oliviers",
    });

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "property-summary",
        version: 1,
        props: { propertyId: property.id },
      },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).toContain("Villa des Oliviers");
  });

  it("UnitGrid renders the Property's real, active Units in their ordering", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    await createUnit({
      tenantId: tenant.id,
      propertyId: property.id,
      publicName: "Villa",
      ordering: 1,
    });
    await createUnit({
      tenantId: tenant.id,
      propertyId: property.id,
      publicName: "Studio",
      ordering: 2,
    });
    await createUnit({
      tenantId: tenant.id,
      propertyId: property.id,
      publicName: "Draft Room",
      status: "draft",
      ordering: 3,
    });

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "unit-grid",
        version: 1,
        props: { propertyId: property.id },
      },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).toContain("Villa");
    expect(html).toContain("Studio");
    expect(html).not.toContain("Draft Room");
    expect(html.indexOf("Villa")).toBeLessThan(html.indexOf("Studio"));
  });

  it("Amenities renders the real catalog entries attached to a Unit", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const unit = await createUnit({ tenantId: tenant.id, propertyId: property.id });
    const amenity = await createAmenity({ label: "Heated pool" });
    await attachUnitAmenity({ tenantId: tenant.id, unitId: unit.id, amenityId: amenity.id });

    const content = [
      { id: generateBlockInstanceId(), type: "amenities", version: 1, props: { unitId: unit.id } },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).toContain("Heated pool");
  });

  it("degrades an invalid block to a placeholder without affecting its neighbors", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "text",
        version: 1,
        props: { body: { fr: "Before" } },
      },
      {
        id: generateBlockInstanceId(),
        type: "hero",
        version: 1,
        props: { headline: "not-a-localized-string" },
      },
      { id: generateBlockInstanceId(), type: "text", version: 1, props: { body: { fr: "After" } } },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      expect(elements).toHaveLength(3);
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).toContain("Before");
    expect(html).toContain("After");
    expect(html).toContain('data-block="unrenderable"');
  });

  it("degrades an unknown block type/version to a placeholder", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });

    const content = [{ id: generateBlockInstanceId(), type: "video", version: 1, props: {} }];

    const elements = await withTenantContext(tenant.id, (tx) =>
      renderBlocks(content, contextFor(tenant.id, site.id, tx)),
    );

    expect(elements).toHaveLength(1);
    const html = renderToStaticMarkup(elements[0]!);
    expect(html).toContain('data-block="unrenderable"');
  });

  it("a domain block referencing another tenant's Property never leaks that tenant's data", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteA = await createSite({ tenantId: tenantA.id, slug: "a", name: "A" });
    const siteB = await createSite({ tenantId: tenantB.id, slug: "b", name: "B" });
    const propertyB = await createProperty({
      tenantId: tenantB.id,
      siteId: siteB.id,
      publicName: "Tenant B Secret Villa",
    });

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "property-summary",
        version: 1,
        props: { propertyId: propertyB.id },
      },
    ];

    const html = await withTenantContext(tenantA.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenantA.id, siteA.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).not.toContain("Tenant B Secret Villa");
    expect(html).toContain('data-block-unavailable="true"');
  });

  it("Hero/Gallery use the frozen manifest (context.media) when present, ignoring a live edit to the same MediaAsset row", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const asset = await createMediaAsset({ tenantId: tenant.id, storageKey: "live/current.jpg" });

    // The frozen descriptor a Revision would have captured at publish time
    // — deliberately DIFFERENT from the live row below, to prove the
    // renderer prefers this over a fresh `tx` lookup when `context.media`
    // is provided (v0.5, section 9 of the brief).
    const frozen: FrozenMediaDescriptor = {
      id: asset.id,
      storageKey: "frozen/at-publish-time.jpg",
      mimeType: "image/jpeg",
      width: null,
      height: null,
      altText: "Frozen alt text",
    };

    // The live row changes AFTER the (simulated) freeze — same as a Draft
    // edit happening after a publish.
    await getAdminDb()
      .update(mediaAssets)
      .set({ storageKey: "live/edited-after-freeze.jpg" })
      .where(eq(mediaAssets.id, asset.id));

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "hero",
        version: 1,
        props: { headline: { fr: "H" }, backgroundMediaId: asset.id },
      },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      const context: RenderContext = {
        ...contextFor(tenant.id, site.id, tx),
        media: new Map([[asset.id, frozen]]),
      };
      const elements = await renderBlocks(content, context);
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).toContain("frozen/at-publish-time.jpg");
    expect(html).not.toContain("live/edited-after-freeze.jpg");
  });

  it("Hero/Gallery fall back to a live lookup when context.media is absent (Draft preview semantics)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const asset = await createMediaAsset({ tenantId: tenant.id, storageKey: "live/preview.jpg" });

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "hero",
        version: 1,
        props: { headline: { fr: "H" }, backgroundMediaId: asset.id },
      },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      // No `media` field at all — same shape apps/admin's preview page builds.
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).toContain("live/preview.jpg");
  });
});

describe("v0.6 — public vs preview Rental visibility (RenderContext.publicOnly)", () => {
  it("PropertySummary shows a draft Property in preview (publicOnly unset) but hides it publicly (publicOnly: true)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      publicName: "Villa En Construction",
      status: "draft",
    });
    const content = [
      {
        id: generateBlockInstanceId(),
        type: "property-summary",
        version: 1,
        props: { propertyId: property.id },
      },
    ];

    const previewHtml = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });
    expect(previewHtml).toContain("Villa En Construction");

    const publicHtml = await withTenantContext(tenant.id, async (tx) => {
      const context: RenderContext = { ...contextFor(tenant.id, site.id, tx), publicOnly: true };
      const elements = await renderBlocks(content, context);
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });
    expect(publicHtml).not.toContain("Villa En Construction");
    expect(publicHtml).toContain('data-block-unavailable="true"');
  });

  it("Presentation-Frozen / Business-Live boundary: identical, unchanged block props render differently before and after the referenced Property is archived — the block config itself never changes", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      publicName: "Villa Frozen Presentation",
      status: "active",
    });
    // This exact object simulates a Revision's frozen block config — it is
    // never mutated between the two renders below.
    const frozenBlockConfig = [
      {
        id: generateBlockInstanceId(),
        type: "property-summary",
        version: 1,
        props: { propertyId: property.id, showAddress: true },
      },
    ];

    const beforeHtml = await withTenantContext(tenant.id, async (tx) => {
      const context: RenderContext = { ...contextFor(tenant.id, site.id, tx), publicOnly: true };
      const elements = await renderBlocks(frozenBlockConfig, context);
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });
    expect(beforeHtml).toContain("Villa Frozen Presentation");

    // The Property is archived afterward — simulating exactly the
    // worked example from section 13 of the brief (a Property later
    // archived while an already-published Revision keeps referencing it).
    await getAdminDb()
      .update(properties)
      .set({ status: "archived" })
      .where(eq(properties.id, property.id));

    const afterHtml = await withTenantContext(tenant.id, async (tx) => {
      const context: RenderContext = { ...contextFor(tenant.id, site.id, tx), publicOnly: true };
      // The exact same, unmodified block config object — proving the
      // Revision's *presentation* never had to change for this to happen.
      const elements = await renderBlocks(frozenBlockConfig, context);
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });
    expect(afterHtml).not.toContain("Villa Frozen Presentation");
    expect(afterHtml).toContain('data-block-unavailable="true"');
  });

  it("UnitGrid hides draft/archived Units under publicOnly, same as preview — status filtering was already unconditional pre-v0.6", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    await createUnit({ tenantId: tenant.id, propertyId: property.id, publicName: "Active Unit" });
    await createUnit({
      tenantId: tenant.id,
      propertyId: property.id,
      publicName: "Draft Unit",
      status: "draft",
    });

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "unit-grid",
        version: 1,
        props: { propertyId: property.id },
      },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      const context: RenderContext = { ...contextFor(tenant.id, site.id, tx), publicOnly: true };
      const elements = await renderBlocks(content, context);
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).toContain("Active Unit");
    expect(html).not.toContain("Draft Unit");
  });

  it("UnitGrid's showBedSummary shows the effective bed count (detail sum over the raw aggregate) when detail rows exist", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const unit = await createUnit({
      tenantId: tenant.id,
      propertyId: property.id,
      publicName: "Suite",
      beds: 9,
    });
    await createSleepingArrangement({
      tenantId: tenant.id,
      unitId: unit.id,
      bedType: "king",
      quantity: 1,
    });
    await createSleepingArrangement({
      tenantId: tenant.id,
      unitId: unit.id,
      bedType: "sofa_bed",
      quantity: 1,
    });

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "unit-grid",
        version: 1,
        props: { propertyId: property.id, showBedSummary: true },
      },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).toContain("2 beds");
    expect(html).not.toContain("9 beds");
  });

  it("Amenities (property-scoped) renders a Property's own attached amenities, distinct from its Units'", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const sharedPool = await createAmenity({ label: "Shared Pool" });
    await attachPropertyAmenity({
      tenantId: tenant.id,
      propertyId: property.id,
      amenityId: sharedPool.id,
    });

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "amenities",
        version: 1,
        props: { propertyId: property.id },
      },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).toContain("Shared Pool");
  });

  it("PropertySummary never renders a private address when locationDisclosure is 'hidden', even publicly", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      publicName: "Secret Retreat",
      status: "active",
      addressLine1: "12 Rue Confidentielle",
      addressCity: "Cassis",
      locationDisclosure: "hidden",
    });

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "property-summary",
        version: 1,
        props: { propertyId: property.id, showAddress: true },
      },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      const context: RenderContext = { ...contextFor(tenant.id, site.id, tx), publicOnly: true };
      const elements = await renderBlocks(content, context);
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).toContain("Secret Retreat");
    expect(html).not.toContain("Rue Confidentielle");
    expect(html).not.toContain("Cassis");
  });
});

describe("v0.7 — VirtualTour block (virtual-tour@1)", () => {
  it("renders the resolved, first-party-constructed Matterport embed src, never a stored HTML/iframe string", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const tour = await createVirtualTour({
      tenantId: tenant.id,
      propertyId: property.id,
      publicName: "Villa Panoramique",
      providerAssetId: "abc12345678",
      status: "active",
    });

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "virtual-tour",
        version: 1,
        props: { tourId: tour.id },
      },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).toContain("Villa Panoramique");
    expect(html).toContain("https://my.matterport.com/show/?m=abc12345678");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('allow="xr-spatial-tracking"');
  });

  it("hides a draft Tour publicly but shows it in preview (RenderContext.publicOnly)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const tour = await createVirtualTour({
      tenantId: tenant.id,
      propertyId: property.id,
      publicName: "Tour En Preparation",
      status: "draft",
    });
    const content = [
      {
        id: generateBlockInstanceId(),
        type: "virtual-tour",
        version: 1,
        props: { tourId: tour.id },
      },
    ];

    const previewHtml = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });
    expect(previewHtml).toContain("Tour En Preparation");

    const publicHtml = await withTenantContext(tenant.id, async (tx) => {
      const context: RenderContext = { ...contextFor(tenant.id, site.id, tx), publicOnly: true };
      const elements = await renderBlocks(content, context);
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });
    expect(publicHtml).not.toContain("Tour En Preparation");
    expect(publicHtml).toContain('data-block-unavailable="true"');
  });

  it("an archived Tour disappears from public rendering immediately, without requiring a republish", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const tour = await createVirtualTour({
      tenantId: tenant.id,
      propertyId: property.id,
      publicName: "Tour Bientot Retiree",
      status: "active",
    });
    // This exact object simulates a Revision's frozen block config — it is
    // never mutated between the two renders below.
    const frozenBlockConfig = [
      {
        id: generateBlockInstanceId(),
        type: "virtual-tour",
        version: 1,
        props: { tourId: tour.id },
      },
    ];

    const beforeHtml = await withTenantContext(tenant.id, async (tx) => {
      const context: RenderContext = { ...contextFor(tenant.id, site.id, tx), publicOnly: true };
      const elements = await renderBlocks(frozenBlockConfig, context);
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });
    expect(beforeHtml).toContain("Tour Bientot Retiree");

    await getAdminDb()
      .update(virtualTours)
      .set({ status: "archived" })
      .where(eq(virtualTours.id, tour.id));

    const afterHtml = await withTenantContext(tenant.id, async (tx) => {
      const context: RenderContext = { ...contextFor(tenant.id, site.id, tx), publicOnly: true };
      // The exact same, unmodified block config object — proving the
      // Revision's *presentation* never had to change for this to happen.
      const elements = await renderBlocks(frozenBlockConfig, context);
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });
    expect(afterHtml).not.toContain("Tour Bientot Retiree");
    expect(afterHtml).toContain('data-block-unavailable="true"');
  });

  it("Presentation-Frozen / Business-Live boundary: an admin repointing the Tour's target asset after publish reflects immediately, without a republish", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const tour = await createVirtualTour({
      tenantId: tenant.id,
      propertyId: property.id,
      providerAssetId: "original111",
      status: "active",
    });
    const frozenBlockConfig = [
      {
        id: generateBlockInstanceId(),
        type: "virtual-tour",
        version: 1,
        props: { tourId: tour.id },
      },
    ];

    const beforeHtml = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(frozenBlockConfig, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });
    expect(beforeHtml).toContain("original111");

    await getAdminDb()
      .update(virtualTours)
      .set({ providerAssetId: "repointed11" })
      .where(eq(virtualTours.id, tour.id));

    const afterHtml = await withTenantContext(tenant.id, async (tx) => {
      // Same unmodified block config — the VirtualTour row is read live,
      // never from any frozen manifest, unlike Hero/Gallery's media.
      const elements = await renderBlocks(frozenBlockConfig, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });
    expect(afterHtml).toContain("repointed11");
    expect(afterHtml).not.toContain("original111");
  });

  it("a VirtualTour block referencing another tenant's Tour never leaks that tenant's data", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteA = await createSite({ tenantId: tenantA.id, slug: "a", name: "A" });
    const siteB = await createSite({ tenantId: tenantB.id, slug: "b", name: "B" });
    const propertyB = await createProperty({ tenantId: tenantB.id, siteId: siteB.id });
    const tourB = await createVirtualTour({
      tenantId: tenantB.id,
      propertyId: propertyB.id,
      publicName: "Tenant B Secret Tour",
      status: "active",
    });

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "virtual-tour",
        version: 1,
        props: { tourId: tourB.id },
      },
    ];

    const html = await withTenantContext(tenantA.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenantA.id, siteA.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).not.toContain("Tenant B Secret Tour");
    expect(html).toContain('data-block-unavailable="true"');
  });

  it("posterMediaId resolves through the same frozen-manifest/live-lookup split as Hero/Gallery", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const tour = await createVirtualTour({
      tenantId: tenant.id,
      propertyId: property.id,
      status: "active",
    });
    const asset = await createMediaAsset({ tenantId: tenant.id, storageKey: "live/poster.jpg" });
    const frozen: FrozenMediaDescriptor = {
      id: asset.id,
      storageKey: "frozen/poster-at-publish.jpg",
      mimeType: "image/jpeg",
      width: null,
      height: null,
      altText: null,
    };

    const content = [
      {
        id: generateBlockInstanceId(),
        type: "virtual-tour",
        version: 1,
        props: { tourId: tour.id, posterMediaId: asset.id },
      },
    ];

    const frozenHtml = await withTenantContext(tenant.id, async (tx) => {
      const context: RenderContext = {
        ...contextFor(tenant.id, site.id, tx),
        media: new Map([[asset.id, frozen]]),
      };
      const elements = await renderBlocks(content, context);
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });
    expect(frozenHtml).toContain("frozen/poster-at-publish.jpg");

    const liveHtml = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });
    expect(liveHtml).toContain("live/poster.jpg");
  });

  it("showTitle: false omits the Tour's publicName from the rendered heading", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, slug: "s", name: "S" });
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const tour = await createVirtualTour({
      tenantId: tenant.id,
      propertyId: property.id,
      publicName: "Tour Sans Titre Visible",
      status: "active",
    });
    const content = [
      {
        id: generateBlockInstanceId(),
        type: "virtual-tour",
        version: 1,
        props: { tourId: tour.id, showTitle: false },
      },
    ];

    const html = await withTenantContext(tenant.id, async (tx) => {
      const elements = await renderBlocks(content, contextFor(tenant.id, site.id, tx));
      return elements.map((el) => renderToStaticMarkup(el)).join("\n");
    });

    expect(html).not.toContain("<h2");
  });
});
