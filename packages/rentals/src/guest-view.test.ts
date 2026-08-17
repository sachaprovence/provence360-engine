import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createProperty,
  createSite,
  createSleepingArrangement,
  createTenant,
  createUnit,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { buildPropertyGuestView, getPropertyGuestView, getUnitGuestView } from "./guest-view";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

async function siteFor(tenantId: string) {
  return createSite({ tenantId });
}

describe("buildPropertyGuestView — location-privacy disclosure (anti-leak)", () => {
  const fullAddress = {
    addressLine1: "12 Rue des Oliviers",
    addressCity: "Cassis",
    addressCountry: "FR",
    latitude: 43.214,
    longitude: 5.5397,
  };

  it("'exact' discloses the full address to a public visitor", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);
    const property = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      status: "active",
      locationDisclosure: "exact",
      ...fullAddress,
    });

    const view = buildPropertyGuestView(property, true);
    expect(view.location.addressLine1).toBe("12 Rue des Oliviers");
    expect(view.location.addressCity).toBe("Cassis");
    expect(view.location.latitude).toBeCloseTo(43.214);
    expect(view.location.longitude).toBeCloseTo(5.5397);
  });

  it("'approximate' discloses only city/region/country to a public visitor — never the street address or exact coordinates", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);
    const property = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      status: "active",
      locationDisclosure: "approximate",
      ...fullAddress,
    });

    const view = buildPropertyGuestView(property, true);
    expect(view.location.addressCity).toBe("Cassis");
    expect(view.location.addressLine1).toBeUndefined();
    expect(view.location.latitude).toBeUndefined();
    expect(view.location.longitude).toBeUndefined();
    // Never a leaked value under a different key either.
    expect(JSON.stringify(view)).not.toContain("12 Rue des Oliviers");
    expect(JSON.stringify(view)).not.toContain("43.214");
  });

  it("'hidden' discloses nothing at all about the location to a public visitor", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);
    const property = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      status: "active",
      locationDisclosure: "hidden",
      ...fullAddress,
    });

    const view = buildPropertyGuestView(property, true);
    expect(view.location).toEqual({ disclosure: "hidden" });
    expect(JSON.stringify(view)).not.toContain("Cassis");
    expect(JSON.stringify(view)).not.toContain("Rue des Oliviers");
  });

  it("the internal/preview view (publicView=false) always sees the full address regardless of locationDisclosure — an owner editing their own data is not a guest", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);
    const property = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      status: "active",
      locationDisclosure: "hidden",
      ...fullAddress,
    });

    const view = buildPropertyGuestView(property, false);
    expect(view.location.addressLine1).toBe("12 Rue des Oliviers");
    expect(view.location.latitude).toBeCloseTo(43.214);
  });

  it("getPropertyGuestView({public:true}) resolves to null for a draft/archived property — no partially-filled leaked view", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);
    const property = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      status: "draft",
      locationDisclosure: "exact",
      ...fullAddress,
    });

    const view = await withTenantContext(tenant.id, (tx) =>
      getPropertyGuestView(tx, property.id, { public: true }),
    );
    expect(view).toBeNull();
  });

  it("getPropertyGuestView without {public:true} (admin/preview default) resolves a draft property fully", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);
    const property = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      status: "draft",
      ...fullAddress,
    });

    const view = await withTenantContext(tenant.id, (tx) => getPropertyGuestView(tx, property.id));
    expect(view?.location.addressCity).toBe("Cassis");
  });
});

describe("buildPropertyGuestView — check-in/out and policies", () => {
  it("exposes check-in/out times and policies unfiltered (not location-privacy-sensitive)", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);
    const property = await createProperty({
      tenantId: tenant.id,
      siteId: site.id,
      status: "active",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
      smokingPolicy: "not_allowed",
      petsPolicy: "on_request",
    });

    const view = buildPropertyGuestView(property, true);
    // Postgres's `time` column round-trips as "HH:MM:SS" regardless of the
    // "HH:MM" shorthand written — `timeOfDaySchema` accepts both on input.
    expect(view.checkInTime).toBe("15:00:00");
    expect(view.checkOutTime).toBe("11:00:00");
    expect(view.quietHours).toEqual({ start: "22:00:00", end: "08:00:00" });
    expect(view.policies.smoking).toBe("not_allowed");
    expect(view.policies.pets).toBe("on_request");
    expect(view.policies.events).toBeUndefined();
  });
});

describe("getUnitGuestView — aggregates-vs-detail bed count strategy", () => {
  it("falls back to the raw `beds` column when no sleeping-arrangement detail rows exist", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const unit = await createUnit({ tenantId: tenant.id, propertyId: property.id, beds: 3 });

    const view = await withTenantContext(tenant.id, (tx) => getUnitGuestView(tx, unit.id));
    expect(view?.effectiveBedCount).toBe(3);
    expect(view?.sleepingArrangements).toEqual([]);
  });

  it("uses the sum of detail-row quantities once any exist, never both beds and detail sums simultaneously", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const unit = await createUnit({ tenantId: tenant.id, propertyId: property.id, beds: 3 });
    await createSleepingArrangement({
      tenantId: tenant.id,
      unitId: unit.id,
      bedType: "king",
      quantity: 1,
      ordering: 0,
    });
    await createSleepingArrangement({
      tenantId: tenant.id,
      unitId: unit.id,
      bedType: "sofa_bed",
      quantity: 2,
      ordering: 1,
    });

    const view = await withTenantContext(tenant.id, (tx) => getUnitGuestView(tx, unit.id));
    // Detail sums to 3, matching the stale `beds` column here — but the
    // point is the source of truth switched to detail, not that they agree.
    expect(view?.effectiveBedCount).toBe(3);
    expect(view?.sleepingArrangements.map((a) => a.bedType)).toEqual(["king", "sofa_bed"]);
  });

  it("a genuine beds-vs-detail mismatch always resolves to the detail sum, proving the two are never displayed simultaneously", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const unit = await createUnit({ tenantId: tenant.id, propertyId: property.id, beds: 3 });
    await createSleepingArrangement({
      tenantId: tenant.id,
      unitId: unit.id,
      bedType: "queen",
      quantity: 5,
      ordering: 0,
    });

    const view = await withTenantContext(tenant.id, (tx) => getUnitGuestView(tx, unit.id));
    expect(view?.effectiveBedCount).toBe(5);
  });

  it("getUnitGuestView({public:true}) resolves to null for a draft unit", async () => {
    const tenant = await createTenant();
    const site = await siteFor(tenant.id);
    const property = await createProperty({ tenantId: tenant.id, siteId: site.id });
    const unit = await createUnit({
      tenantId: tenant.id,
      propertyId: property.id,
      status: "draft",
    });

    const view = await withTenantContext(tenant.id, (tx) =>
      getUnitGuestView(tx, unit.id, { public: true }),
    );
    expect(view).toBeNull();
  });
});
