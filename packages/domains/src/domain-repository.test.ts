import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSite,
  createTenant,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { createDomain, listDomainsForSite, SiteNotFoundError } from "./domain-repository";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("createDomain", () => {
  it("attaches a hostname to a site owned by the current tenant", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    const domain = await withTenantContext(tenant.id, (tx) =>
      createDomain(tx, { siteId: site.id, hostname: "Villa-Cassis.COM" }),
    );

    expect(domain.tenantId).toBe(tenant.id);
    expect(domain.siteId).toBe(site.id);
    // normalized: lowercased.
    expect(domain.hostname).toBe("villa-cassis.com");
  });

  it("refuses to attach a domain to another tenant's site", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await createSite({ tenantId: tenantB.id });

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        createDomain(tx, { siteId: siteB.id, hostname: "steal-me.example.com" }),
      ),
    ).rejects.toThrow(SiteNotFoundError);
  });

  it("rejects two tenants simultaneously claiming the same active hostname", async () => {
    const tenantA = await createTenant();
    const siteA = await createSite({ tenantId: tenantA.id });
    await withTenantContext(tenantA.id, (tx) =>
      createDomain(tx, { siteId: siteA.id, hostname: "contested.example.com", status: "active" }),
    );

    const tenantB = await createTenant();
    const siteB = await createSite({ tenantId: tenantB.id });

    await expect(
      withTenantContext(tenantB.id, (tx) =>
        createDomain(tx, {
          siteId: siteB.id,
          hostname: "contested.example.com",
          status: "active",
        }),
      ),
    ).rejects.toThrow();
  });

  it("allows the same hostname to be reused once no longer active (pending/disabled don't collide)", async () => {
    const tenantA = await createTenant();
    const siteA = await createSite({ tenantId: tenantA.id });
    await withTenantContext(tenantA.id, (tx) =>
      createDomain(tx, {
        siteId: siteA.id,
        hostname: "released.example.com",
        status: "disabled",
      }),
    );

    const tenantB = await createTenant();
    const siteB = await createSite({ tenantId: tenantB.id });

    const domain = await withTenantContext(tenantB.id, (tx) =>
      createDomain(tx, { siteId: siteB.id, hostname: "released.example.com", status: "active" }),
    );

    expect(domain.hostname).toBe("released.example.com");
  });
});

describe("listDomainsForSite", () => {
  it("only lists domains belonging to the current tenant's site", async () => {
    const tenantA = await createTenant();
    const siteA = await createSite({ tenantId: tenantA.id });
    await withTenantContext(tenantA.id, (tx) =>
      createDomain(tx, { siteId: siteA.id, hostname: "a1.example.com" }),
    );
    await withTenantContext(tenantA.id, (tx) =>
      createDomain(tx, { siteId: siteA.id, hostname: "a2.example.com" }),
    );

    const domains = await withTenantContext(tenantA.id, (tx) => listDomainsForSite(tx, siteA.id));

    expect(domains.map((d) => d.hostname).sort()).toEqual(["a1.example.com", "a2.example.com"]);
  });

  it("returns nothing when asked about another tenant's site", async () => {
    const tenantA = await createTenant();
    const siteA = await createSite({ tenantId: tenantA.id });
    await withTenantContext(tenantA.id, (tx) =>
      createDomain(tx, { siteId: siteA.id, hostname: "a1.example.com" }),
    );

    const tenantB = await createTenant();
    const domains = await withTenantContext(tenantB.id, (tx) => listDomainsForSite(tx, siteA.id));

    expect(domains).toHaveLength(0);
  });
});
