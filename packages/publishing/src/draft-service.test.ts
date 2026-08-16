import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPage, getPageBySlug, updateBlockProps, updatePageMeta } from "@provence360/content";
import {
  createSite,
  createTenant,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { getDraftSummary } from "./draft-service";
import { publishSite } from "./publish";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("getDraftSummary", () => {
  it("hasUnpublishedChanges is true and issues explain why for an unpublishable site", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    const summary = await withTenantContext(tenant.id, (tx) => getDraftSummary(tx, site.id));

    expect(summary.hasUnpublishedChanges).toBe(true);
    expect(summary.publishedRevisionId).toBeNull();
    expect(summary.issues.some((i) => i.code === "missing_home_page")).toBe(true);
  });

  it("hasUnpublishedChanges is true before a first publish, once the draft is valid", async () => {
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

    const summary = await withTenantContext(tenant.id, (tx) => getDraftSummary(tx, site.id));
    expect(summary.hasUnpublishedChanges).toBe(true);
    expect(summary.issues).toHaveLength(0);
  });

  it("hasUnpublishedChanges flips to false immediately after publishing", async () => {
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
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    const summary = await withTenantContext(tenant.id, (tx) => getDraftSummary(tx, site.id));
    expect(summary.hasUnpublishedChanges).toBe(false);
    expect(summary.publishedRevisionNumber).toBe(1);
    expect(summary.publishedAt).not.toBeNull();
  });

  it("hasUnpublishedChanges flips back to true the moment the draft diverges from what's published", async () => {
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
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    const home = await withTenantContext(tenant.id, (tx) => getPageBySlug(tx, site.id, ""));
    if (!home) throw new Error("test setup: home page not found");
    await withTenantContext(tenant.id, (tx) =>
      updatePageMeta(tx, { id: home.id, internalName: "Home (edited)" }),
    );

    const summary = await withTenantContext(tenant.id, (tx) => getDraftSummary(tx, site.id));
    expect(summary.hasUnpublishedChanges).toBe(true);
  });

  it("adding then reverting a block-level edit is detected as a real change (deep content comparison, not just page metadata)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const page = await withTenantContext(tenant.id, (tx) =>
      createPage(tx, {
        siteId: site.id,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        content: [{ id: "b1", type: "text", version: 1, props: { body: { fr: "Original" } } }],
      }),
    );
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    await withTenantContext(tenant.id, (tx) =>
      updateBlockProps(tx, { pageId: page.id, blockId: "b1", props: { body: { fr: "Changed" } } }),
    );
    const changed = await withTenantContext(tenant.id, (tx) => getDraftSummary(tx, site.id));
    expect(changed.hasUnpublishedChanges).toBe(true);

    await withTenantContext(tenant.id, (tx) =>
      updateBlockProps(tx, { pageId: page.id, blockId: "b1", props: { body: { fr: "Original" } } }),
    );
    const reverted = await withTenantContext(tenant.id, (tx) => getDraftSummary(tx, site.id));
    expect(reverted.hasUnpublishedChanges).toBe(false);
  });
});
