import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDomain as createTestDomain,
  createTenant,
  createSite,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { resolveSiteByHostname } from "./resolver";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("resolveSiteByHostname", () => {
  it("resolves a known, active hostname to its site and tenant", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id, status: "active" });
    await createTestDomain({
      tenantId: tenant.id,
      siteId: site.id,
      hostname: "villas-cassis.provence360.app",
      isPrimary: true,
      status: "active",
    });

    const resolved = await resolveSiteByHostname("villas-cassis.provence360.app");

    expect(resolved).toEqual({
      siteId: site.id,
      tenantId: tenant.id,
      siteStatus: "active",
    });
  });

  it("normalizes the hostname before resolving (case, port, www)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    await createTestDomain({
      tenantId: tenant.id,
      siteId: site.id,
      hostname: "villas-cassis.provence360.app",
      status: "active",
    });

    const resolved = await resolveSiteByHostname("WWW.Villas-Cassis.PROVENCE360.APP:8443");

    expect(resolved?.siteId).toBe(site.id);
  });

  it("fails cleanly (returns null) for an unknown hostname", async () => {
    const resolved = await resolveSiteByHostname("does-not-exist.example.com");
    expect(resolved).toBeNull();
  });

  it("fails cleanly (returns null) for a malformed hostname", async () => {
    const resolved = await resolveSiteByHostname("not a hostname/../etc");
    expect(resolved).toBeNull();
  });

  it("does not resolve a domain that is not active", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    await createTestDomain({
      tenantId: tenant.id,
      siteId: site.id,
      hostname: "pending.example.com",
      status: "pending",
    });

    const resolved = await resolveSiteByHostname("pending.example.com");

    expect(resolved).toBeNull();
  });
});
