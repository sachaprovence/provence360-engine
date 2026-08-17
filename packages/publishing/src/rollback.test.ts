import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPage, getPageBySlug, updatePageMeta } from "@provence360/content";
import {
  createSite,
  createTenant,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { updateSiteNavigation } from "@provence360/sites";
import { publishSite } from "./publish";
import { getPublishedRevision } from "./published-revision";
import { RevisionNotFoundError } from "./errors";
import { rollbackSite } from "./rollback";
import { listRevisions, listPublicationHistory } from "./draft-service";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

async function seedPublishableSite(tenantId: string, headline: string) {
  const site = await createSite({ tenantId });
  await withTenantContext(tenantId, (tx) =>
    createPage(tx, {
      siteId: site.id,
      slug: "",
      internalName: headline,
      pageType: "home",
      status: "active",
    }),
  );
  return site;
}

describe("rollbackSite", () => {
  it("republishes an older revision without creating a new one, and preserves it unmodified (Invariant E)", async () => {
    const tenant = await createTenant();
    const site = await seedPublishableSite(tenant.id, "v1");
    const v1 = await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    const home = await withTenantContext(tenant.id, (tx) => getPageBySlug(tx, site.id, ""));
    if (!home) throw new Error("test setup: home page not found");
    await withTenantContext(tenant.id, (tx) =>
      updatePageMeta(tx, { id: home.id, internalName: "v2" }),
    );
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    const revisionsBeforeRollback = await withTenantContext(tenant.id, (tx) =>
      listRevisions(tx, site.id),
    );
    expect(revisionsBeforeRollback).toHaveLength(2);

    const rollback = await withTenantContext(tenant.id, (tx) =>
      rollbackSite(tx, { siteId: site.id, targetRevisionId: v1.revisionId }),
    );
    expect(rollback.action).toBe("rollback");
    expect(rollback.revisionId).toBe(v1.revisionId);

    // No new revision was created by the rollback itself.
    const revisionsAfterRollback = await withTenantContext(tenant.id, (tx) =>
      listRevisions(tx, site.id),
    );
    expect(revisionsAfterRollback).toHaveLength(2);

    const published = await withTenantContext(tenant.id, (tx) => getPublishedRevision(tx, site.id));
    expect(published?.revisionNumber).toBe(1);
    expect(published?.snapshot.pages[0]?.internalName).toBe("v1");
  });

  it("leaves a visible trace in the publication history", async () => {
    const tenant = await createTenant();
    const site = await seedPublishableSite(tenant.id, "v1");
    const v1 = await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));
    await withTenantContext(tenant.id, (tx) =>
      rollbackSite(tx, { siteId: site.id, targetRevisionId: v1.revisionId }),
    );

    const history = await withTenantContext(tenant.id, (tx) => listPublicationHistory(tx, site.id));
    expect(history).toHaveLength(2);
    expect(history[0]?.action).toBe("rollback");
    expect(history[1]?.action).toBe("publish");
  });

  it("refuses to roll back to a revision id from another tenant (Invariant F)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteA = await seedPublishableSite(tenantA.id, "a");
    const siteB = await seedPublishableSite(tenantB.id, "b");
    await withTenantContext(tenantA.id, (tx) => publishSite(tx, { siteId: siteA.id }));
    const publicationB = await withTenantContext(tenantB.id, (tx) =>
      publishSite(tx, { siteId: siteB.id }),
    );

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        rollbackSite(tx, { siteId: siteA.id, targetRevisionId: publicationB.revisionId }),
      ),
    ).rejects.toThrow(RevisionNotFoundError);

    // Tenant A's site is untouched.
    const published = await withTenantContext(tenantA.id, (tx) =>
      getPublishedRevision(tx, siteA.id),
    );
    expect(published?.revisionNumber).toBe(1);
  });

  it("refuses to roll a site back to a revision belonging to a different site in the same tenant", async () => {
    const tenant = await createTenant();
    const siteA = await seedPublishableSite(tenant.id, "a");
    const siteC = await seedPublishableSite(tenant.id, "c");
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: siteA.id }));
    const publicationC = await withTenantContext(tenant.id, (tx) =>
      publishSite(tx, { siteId: siteC.id }),
    );

    await expect(
      withTenantContext(tenant.id, (tx) =>
        rollbackSite(tx, { siteId: siteA.id, targetRevisionId: publicationC.revisionId }),
      ),
    ).rejects.toThrow(RevisionNotFoundError);
  });

  it("restores the entire frozen composition (not just page content) — navigation reverts too", async () => {
    const tenant = await createTenant();
    const site = await seedPublishableSite(tenant.id, "v1");
    const home = await withTenantContext(tenant.id, (tx) => getPageBySlug(tx, site.id, ""));
    if (!home) throw new Error("test setup: home page not found");

    await withTenantContext(tenant.id, (tx) =>
      updateSiteNavigation(tx, {
        id: site.id,
        navigation: {
          version: 1,
          items: [{ id: "n1", label: { fr: "V1 nav" }, target: { kind: "page", pageId: home.id } }],
        },
      }),
    );
    const v1 = await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    await withTenantContext(tenant.id, (tx) =>
      updateSiteNavigation(tx, { id: site.id, navigation: { version: 1, items: [] } }),
    );
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));
    const beforeRollback = await withTenantContext(tenant.id, (tx) =>
      getPublishedRevision(tx, site.id),
    );
    expect(beforeRollback?.snapshot.site.navigation.items).toHaveLength(0);

    await withTenantContext(tenant.id, (tx) =>
      rollbackSite(tx, { siteId: site.id, targetRevisionId: v1.revisionId }),
    );

    const afterRollback = await withTenantContext(tenant.id, (tx) =>
      getPublishedRevision(tx, site.id),
    );
    expect(afterRollback?.snapshot.site.navigation.items).toHaveLength(1);
    expect(afterRollback?.snapshot.site.navigation.items[0]?.target).toEqual({
      kind: "page",
      slug: "",
    });
  });
});
