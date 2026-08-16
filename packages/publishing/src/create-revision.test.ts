import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPage } from "@provence360/content";
import {
  createSite,
  createTenant,
  createUser,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { createRevisionFromDraft } from "./create-revision";
import { PublishValidationError, SiteNotFoundError } from "./errors";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

async function seedPublishableSite(tenantId: string) {
  const site = await createSite({ tenantId });
  await withTenantContext(tenantId, (tx) =>
    createPage(tx, {
      siteId: site.id,
      slug: "",
      internalName: "Home",
      pageType: "home",
      status: "active",
    }),
  );
  return site;
}

describe("createRevisionFromDraft", () => {
  it("freezes the current draft into an immutable, tenant-scoped Revision numbered 1 for a first call", async () => {
    const tenant = await createTenant();
    const site = await seedPublishableSite(tenant.id);
    const user = await createUser();

    const revision = await withTenantContext(tenant.id, (tx) =>
      createRevisionFromDraft(tx, { siteId: site.id, actorUserId: user.id }),
    );

    expect(revision.tenantId).toBe(tenant.id);
    expect(revision.siteId).toBe(site.id);
    expect(revision.revisionNumber).toBe(1);
    expect(revision.createdByUserId).toBe(user.id);
  });

  it("increments revisionNumber monotonically across repeated calls on the same site", async () => {
    const tenant = await createTenant();
    const site = await seedPublishableSite(tenant.id);

    const first = await withTenantContext(tenant.id, (tx) =>
      createRevisionFromDraft(tx, { siteId: site.id }),
    );
    const second = await withTenantContext(tenant.id, (tx) =>
      createRevisionFromDraft(tx, { siteId: site.id }),
    );

    expect(first.revisionNumber).toBe(1);
    expect(second.revisionNumber).toBe(2);
    expect(second.id).not.toBe(first.id);
  });

  it("refuses to snapshot an invalid draft (no active home page)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    await expect(
      withTenantContext(tenant.id, (tx) => createRevisionFromDraft(tx, { siteId: site.id })),
    ).rejects.toThrow(PublishValidationError);
  });

  it("refuses to create a revision for another tenant's site", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await seedPublishableSite(tenantB.id);

    await expect(
      withTenantContext(tenantA.id, (tx) => createRevisionFromDraft(tx, { siteId: siteB.id })),
    ).rejects.toThrow(SiteNotFoundError);
  });

  it("two concurrent calls on the same site never collide on revisionNumber", async () => {
    const tenant = await createTenant();
    const site = await seedPublishableSite(tenant.id);

    const [a, b] = await Promise.all([
      withTenantContext(tenant.id, (tx) => createRevisionFromDraft(tx, { siteId: site.id })),
      withTenantContext(tenant.id, (tx) => createRevisionFromDraft(tx, { siteId: site.id })),
    ]);

    expect(new Set([a.revisionNumber, b.revisionNumber]).size).toBe(2);
    expect(new Set([1, 2])).toEqual(new Set([a.revisionNumber, b.revisionNumber]));
  });
});
