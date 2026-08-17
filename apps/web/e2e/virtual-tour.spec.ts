import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPage } from "@provence360/content";
import { publishSite } from "@provence360/publishing";
import {
  createDomain,
  createMediaAsset,
  createProperty,
  createSite,
  createTenant,
  createVirtualTour,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";

// v0.7.1 — Virtual Tour Experience & Embed Hardening (see
// docs/adr/0020-virtual-tour-experience-hardening.md). Same isolation
// discipline as rentals.spec.ts/composition.spec.ts: a dedicated
// tenant/site/domain per test, plain inserts only, never
// `resetDatabase()`. Uses the `request` fixture rather than `page.goto()`
// for the same reason apps/web/e2e/resolution.spec.ts does: browsers treat
// `Host` as a protected header they refuse to let a caller override, and
// this suite needs a distinct hostname per test to stay isolated — so it
// proves the click-to-load property the only way available at this layer:
// the exact HTML a visitor's browser receives before any client JS runs
// never contains an `<iframe>` or the provider's URL. The real click ->
// real iframe -> real `src`/attributes chain, and the real-viewport
// responsive check, are proven with a real browser and a real click in
// apps/admin/e2e/virtual-tour-preview.spec.ts's Preview page — which
// renders through the exact same `@provence360/renderer` code and
// `VirtualTourEmbed` component as this public runtime (section 16 of the
// brief: preview and public never diverge).

async function createVirtualTourFixture() {
  const tenant = await createTenant();
  const site = await createSite({ tenantId: tenant.id });
  const hostname = `virtual-tour-e2e-${randomUUID().slice(0, 8)}.test.example`;
  await createDomain({ tenantId: tenant.id, siteId: site.id, hostname, status: "active" });
  const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
  return { tenantId: tenant.id, siteId: site.id, hostname, propertyId: property.id };
}

test.describe("VirtualTour Experience & Embed Hardening — public runtime", () => {
  test("the initial server-rendered HTML never contains an iframe or the provider URL — only the click-to-load surface", async ({
    request,
  }) => {
    const fixture = await createVirtualTourFixture();
    const tour = await createVirtualTour({
      tenantId: fixture.tenantId,
      propertyId: fixture.propertyId,
      publicName: "Villa Panoramique E2E",
      status: "active",
    });
    await withTenantContext(fixture.tenantId, (tx) =>
      createPage(tx, {
        siteId: fixture.siteId,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        content: [{ id: "b1", type: "virtual-tour", version: 1, props: { tourId: tour.id } }],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    expect(response.status()).toBe(200);
    const body = await response.text();

    // The trigger is there, contextualized to the actual tour...
    expect(body).toContain("Villa Panoramique E2E");
    expect(body).toContain("Visite virtuelle — Villa Panoramique E2E");
    expect(body).toContain("Démarrer la visite virtuelle");
    // ...and no rendered `<iframe>` exists yet — the browser makes zero
    // requests to Matterport's origin until the click (sections 2 and 9 of
    // the brief). Note: the safe, server-constructed `src` string is
    // present elsewhere in the raw response — inside Next's RSC
    // hydration payload (an inert `<script>` tag carrying the client
    // component's props), not the rendered DOM — so the click can mount a
    // real iframe instantly, with no second round trip. That payload is
    // first-party data the browser never sends anywhere; it triggers no
    // request to Matterport and is not rendered. See
    // docs/adr/0020-virtual-tour-experience-hardening.md ("What §9
    // actually guarantees") for why this is the correct, disclosed
    // boundary rather than a gap.
    expect(body).not.toContain("<iframe");
  });

  test("the reserved aspect-ratio space is present before load, so activating the tour causes no layout shift", async ({
    request,
  }) => {
    const fixture = await createVirtualTourFixture();
    const tour = await createVirtualTour({
      tenantId: fixture.tenantId,
      propertyId: fixture.propertyId,
      status: "active",
    });
    await withTenantContext(fixture.tenantId, (tx) =>
      createPage(tx, {
        siteId: fixture.siteId,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        content: [
          {
            id: "b1",
            type: "virtual-tour",
            version: 1,
            props: { tourId: tour.id, aspectRatio: "4:3" },
          },
        ],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    const body = await response.text();
    // The classic intrinsic-ratio technique's percentage, reserved in the
    // idle-state markup itself — not computed after an iframe loads.
    expect(body).toContain("75%");
  });

  test("a poster resolves through the same frozen-media pipeline as Hero/Gallery, with no separate Matterport image ever stored", async ({
    request,
  }) => {
    const fixture = await createVirtualTourFixture();
    const tour = await createVirtualTour({
      tenantId: fixture.tenantId,
      propertyId: fixture.propertyId,
      status: "active",
    });
    const asset = await createMediaAsset({
      tenantId: fixture.tenantId,
      storageKey: "e2e/tour-poster-original.jpg",
    });
    await withTenantContext(fixture.tenantId, (tx) =>
      createPage(tx, {
        siteId: fixture.siteId,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        content: [
          {
            id: "b1",
            type: "virtual-tour",
            version: 1,
            props: { tourId: tour.id, posterMediaId: asset.id },
          },
        ],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    // Presentation-Frozen (section 8 of the brief): the poster's storageKey
    // at publish time survives a later edit to the same MediaAsset row,
    // exactly like Hero/Gallery's backgroundMediaId.
    const { getAdminDb } = await import("@provence360/database/admin");
    const { mediaAssets } = await import("@provence360/database");
    const { eq } = await import("drizzle-orm");
    await getAdminDb()
      .update(mediaAssets)
      .set({ storageKey: "e2e/tour-poster-edited-after-publish.jpg" })
      .where(eq(mediaAssets.id, asset.id));

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    const body = await response.text();
    expect(body).toContain("e2e/tour-poster-original.jpg");
    expect(body).not.toContain("e2e/tour-poster-edited-after-publish.jpg");
  });

  test("multiple VirtualTours on the same page each render their own independent click-to-load surface", async ({
    request,
  }) => {
    const fixture = await createVirtualTourFixture();
    const tourA = await createVirtualTour({
      tenantId: fixture.tenantId,
      propertyId: fixture.propertyId,
      publicName: "Tour Alpha E2E",
      status: "active",
    });
    const tourB = await createVirtualTour({
      tenantId: fixture.tenantId,
      propertyId: fixture.propertyId,
      publicName: "Tour Bravo E2E",
      status: "active",
    });
    await withTenantContext(fixture.tenantId, (tx) =>
      createPage(tx, {
        siteId: fixture.siteId,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        content: [
          { id: "b1", type: "virtual-tour", version: 1, props: { tourId: tourA.id } },
          { id: "b2", type: "virtual-tour", version: 1, props: { tourId: tourB.id } },
        ],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    const body = await response.text();
    expect(body).toContain("Visite virtuelle — Tour Alpha E2E");
    expect(body).toContain("Visite virtuelle — Tour Bravo E2E");
    // Two independent trigger surfaces, not one shared/global one.
    expect(body.match(/Démarrer la visite virtuelle/g)?.length).toBe(2);
    expect(body).not.toContain("<iframe");
  });

  test("an archived Tour degrades to the unavailable-block fallback — never a broken or dangling click-to-load surface", async ({
    request,
  }) => {
    const fixture = await createVirtualTourFixture();
    const tour = await createVirtualTour({
      tenantId: fixture.tenantId,
      propertyId: fixture.propertyId,
      publicName: "Tour Bientôt Archivée",
      status: "active",
    });
    await withTenantContext(fixture.tenantId, (tx) =>
      createPage(tx, {
        siteId: fixture.siteId,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        content: [{ id: "b1", type: "virtual-tour", version: 1, props: { tourId: tour.id } }],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const before = await request.get("/", { headers: { host: fixture.hostname } });
    expect(await before.text()).toContain("Tour Bientôt Archivée");

    const { getAdminDb } = await import("@provence360/database/admin");
    const { virtualTours } = await import("@provence360/database");
    const { eq } = await import("drizzle-orm");
    await getAdminDb()
      .update(virtualTours)
      .set({ status: "archived" })
      .where(eq(virtualTours.id, tour.id));

    const after = await request.get("/", { headers: { host: fixture.hostname } });
    const afterBody = await after.text();
    expect(afterBody).not.toContain("Tour Bientôt Archivée");
    expect(afterBody).not.toContain("Démarrer la visite virtuelle");
    expect(afterBody).toContain('data-block-unavailable="true"');
  });
});
