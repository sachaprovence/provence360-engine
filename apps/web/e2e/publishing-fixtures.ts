import { randomUUID } from "node:crypto";
import { createPage } from "@provence360/content";
import { loadDotEnv } from "@provence360/database";
import { createDomain, createSite, createTenant } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";

// A dedicated tenant/site/domain per test run — never the shared seeded
// "villas-cassis"/"mas-du-luberon" fixtures resolution.spec.ts depends on.
// apps/web's Playwright config runs test files in parallel (see
// playwright.config.ts), so this must never touch shared state: only plain
// inserts (packages/testkit's factories), never `resetDatabase()` (which
// would TRUNCATE every tenant's data, including the other spec's).
loadDotEnv();

export interface PublishingFixture {
  tenantId: string;
  siteId: string;
  hostname: string;
}

export async function createPublishingFixture(): Promise<PublishingFixture> {
  const tenant = await createTenant();
  const site = await createSite({ tenantId: tenant.id });
  const hostname = `publishing-e2e-${randomUUID().slice(0, 8)}.test.example`;
  await createDomain({ tenantId: tenant.id, siteId: site.id, hostname, status: "active" });

  await withTenantContext(tenant.id, (tx) =>
    createPage(tx, {
      siteId: site.id,
      slug: "",
      internalName: "Home",
      pageType: "home",
      status: "active",
      content: [{ id: "hero", type: "text", version: 1, props: { body: { fr: "Version 1" } } }],
    }),
  );

  return { tenantId: tenant.id, siteId: site.id, hostname };
}
