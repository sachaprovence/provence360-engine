import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppTx } from "@provence360/database";
import { generateBlockInstanceId } from "@provence360/content";
import { resolveTheme } from "@provence360/themes";
import {
  attachUnitAmenity,
  createAmenity,
  createProperty,
  createSite,
  createTenant,
  createUnit,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { renderBlocks } from "./index";
import type { RenderContext } from "./render-context";

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
});
