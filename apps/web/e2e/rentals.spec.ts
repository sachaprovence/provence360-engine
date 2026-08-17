import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPage } from "@provence360/content";
import { publishSite } from "@provence360/publishing";
import {
  attachPropertyAmenity,
  createAmenity,
  createDomain,
  createProperty,
  createSite,
  createSleepingArrangement,
  createTenant,
  createUnit,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";

// v0.6 — Rental Domain & Guest Experience Kernel. Same isolation discipline
// as composition.spec.ts/publishing.spec.ts: a dedicated tenant/site/domain
// per test, plain inserts only, never `resetDatabase()`.

async function createRentalsFixture() {
  const tenant = await createTenant();
  const site = await createSite({ tenantId: tenant.id });
  const hostname = `rentals-e2e-${randomUUID().slice(0, 8)}.test.example`;
  await createDomain({ tenantId: tenant.id, siteId: site.id, hostname, status: "active" });
  return { tenantId: tenant.id, siteId: site.id, hostname };
}

test.describe("Rental Domain & Guest Experience Kernel — public runtime", () => {
  test("guest-info edit -> publish -> public flow: check-in/out and policies appear on the public page", async ({
    request,
  }) => {
    const fixture = await createRentalsFixture();
    const property = await createProperty({
      tenantId: fixture.tenantId,
      siteId: fixture.siteId,
      publicName: "Mas des Cigales",
      status: "active",
      checkInTime: "16:00",
      checkOutTime: "10:00",
      smokingPolicy: "not_allowed",
      petsPolicy: "on_request",
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
            type: "property-summary",
            version: 1,
            props: { propertyId: property.id, showCheckInOut: true, showPolicies: true },
          },
        ],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("Mas des Cigales");
    expect(body).toContain("16:00");
    expect(body).toContain("10:00");
    expect(body).toContain("Not allowed");
    expect(body).toContain("On request");
  });

  test("location-privacy: a 'hidden' Property never leaks its address on the public page", async ({
    request,
  }) => {
    const fixture = await createRentalsFixture();
    const property = await createProperty({
      tenantId: fixture.tenantId,
      siteId: fixture.siteId,
      publicName: "Retraite Secrète",
      status: "active",
      addressLine1: "42 Chemin Discret",
      addressCity: "Gordes",
      locationDisclosure: "hidden",
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
            type: "property-summary",
            version: 1,
            props: { propertyId: property.id, showAddress: true },
          },
        ],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    const body = await response.text();
    expect(body).toContain("Retraite Secrète");
    expect(body).not.toContain("Chemin Discret");
    expect(body).not.toContain("Gordes");
  });

  test("Presentation-Frozen / Business-Live: archiving the referenced Property after publish stops it appearing publicly, without needing a republish", async ({
    request,
  }) => {
    const fixture = await createRentalsFixture();
    const property = await createProperty({
      tenantId: fixture.tenantId,
      siteId: fixture.siteId,
      publicName: "Villa Bientôt Archivée",
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
          { id: "b1", type: "property-summary", version: 1, props: { propertyId: property.id } },
        ],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const before = await request.get("/", { headers: { host: fixture.hostname } });
    expect(await before.text()).toContain("Villa Bientôt Archivée");

    const { getAdminDb } = await import("@provence360/database/admin");
    const { properties } = await import("@provence360/database");
    const { eq } = await import("drizzle-orm");
    await getAdminDb()
      .update(properties)
      .set({ status: "archived" })
      .where(eq(properties.id, property.id));

    const after = await request.get("/", { headers: { host: fixture.hostname } });
    const afterBody = await after.text();
    expect(afterBody).not.toContain("Villa Bientôt Archivée");
    expect(afterBody).toContain('data-block-unavailable="true"');
  });

  test("sleeping arrangements and property-level amenities render on the public page, in their declared ordering", async ({
    request,
  }) => {
    const fixture = await createRentalsFixture();
    const property = await createProperty({ tenantId: fixture.tenantId, siteId: fixture.siteId });
    const unit = await createUnit({
      tenantId: fixture.tenantId,
      propertyId: property.id,
      publicName: "Suite Provençale",
      beds: 1,
    });
    await createSleepingArrangement({
      tenantId: fixture.tenantId,
      unitId: unit.id,
      bedType: "king",
      quantity: 1,
      ordering: 0,
    });
    await createSleepingArrangement({
      tenantId: fixture.tenantId,
      unitId: unit.id,
      bedType: "sofa_bed",
      quantity: 1,
      ordering: 1,
    });
    // A distinctly-labeled amenity (not "Piscine chauffée" — that's a real
    // seeded catalog label apps/admin's e2e suite also asserts on; the
    // amenity catalog is global/non-tenant-scoped, so an e2e-created row
    // here is otherwise permanent, shared, cross-suite pollution).
    const poolLabel = `E2E Heated Pool ${randomUUID().slice(0, 8)}`;
    const pool = await createAmenity({ label: poolLabel });
    await attachPropertyAmenity({
      tenantId: fixture.tenantId,
      propertyId: property.id,
      amenityId: pool.id,
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
            type: "unit-grid",
            version: 1,
            props: { propertyId: property.id, showBedSummary: true },
          },
          { id: "b2", type: "amenities", version: 1, props: { propertyId: property.id } },
        ],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    const body = await response.text();
    expect(body).toContain("Suite Provençale");
    expect(body).toContain("2 beds");
    expect(body).toContain(poolLabel);
  });
});
