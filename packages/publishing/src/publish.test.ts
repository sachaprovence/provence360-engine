import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPage, getPageBySlug, updatePageMeta } from "@provence360/content";
import {
  createSite,
  createTenant,
  createUser,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { PublishValidationError } from "./errors";
import { getPublishedRevision } from "./published-revision";
import { publishSite } from "./publish";

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
      content: [{ id: "b1", type: "text", version: 1, props: { body: { fr: "v1" } } }],
    }),
  );
  return site;
}

describe("publishSite", () => {
  it("Invariant A/B: nothing is published until publishSite is called — the public runtime sees nothing", async () => {
    const tenant = await createTenant();
    const site = await seedPublishableSite(tenant.id);

    const published = await withTenantContext(tenant.id, (tx) => getPublishedRevision(tx, site.id));
    expect(published).toBeNull();
  });

  it("a first publish creates revision #1 and makes it immediately readable by the public runtime", async () => {
    const tenant = await createTenant();
    const site = await seedPublishableSite(tenant.id);
    const user = await createUser();

    const publication = await withTenantContext(tenant.id, (tx) =>
      publishSite(tx, { siteId: site.id, actorUserId: user.id }),
    );
    expect(publication.action).toBe("publish");
    expect(publication.previousRevisionId).toBeNull();

    const published = await withTenantContext(tenant.id, (tx) => getPublishedRevision(tx, site.id));
    expect(published).not.toBeNull();
    expect(published?.revisionNumber).toBe(1);
    expect(published?.snapshot.pages[0]?.content[0]).toMatchObject({
      props: { body: { fr: "v1" } },
    });
  });

  it("editing the draft after publishing does not change what the public runtime sees (Invariant A/D)", async () => {
    const tenant = await createTenant();
    const site = await seedPublishableSite(tenant.id);
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    const home = await withTenantContext(tenant.id, (tx) => getPageBySlug(tx, site.id, ""));
    if (!home) throw new Error("test setup: home page not found");
    await withTenantContext(tenant.id, (tx) =>
      updatePageMeta(tx, { id: home.id, internalName: "Home (edited)" }),
    );

    const published = await withTenantContext(tenant.id, (tx) => getPublishedRevision(tx, site.id));
    expect(published?.snapshot.pages[0]?.internalName).toBe("Home");
  });

  it("publishing a second time creates revision #2 and flips the pointer, keeping revision #1 intact", async () => {
    const tenant = await createTenant();
    const site = await seedPublishableSite(tenant.id);
    const firstPublication = await withTenantContext(tenant.id, (tx) =>
      publishSite(tx, { siteId: site.id }),
    );

    const home = await withTenantContext(tenant.id, (tx) => getPageBySlug(tx, site.id, ""));
    if (!home) throw new Error("test setup: home page not found");
    await withTenantContext(tenant.id, (tx) =>
      updatePageMeta(tx, { id: home.id, internalName: "Home v2" }),
    );

    const secondPublication = await withTenantContext(tenant.id, (tx) =>
      publishSite(tx, { siteId: site.id }),
    );
    expect(secondPublication.previousRevisionId).toBe(firstPublication.revisionId);

    const published = await withTenantContext(tenant.id, (tx) => getPublishedRevision(tx, site.id));
    expect(published?.revisionNumber).toBe(2);
    expect(published?.snapshot.pages[0]?.internalName).toBe("Home v2");
  });

  it("Invariant C: an invalid draft is refused and the previous publication remains live (no partial publish)", async () => {
    const tenant = await createTenant();
    const site = await seedPublishableSite(tenant.id);
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    const home = await withTenantContext(tenant.id, (tx) => getPageBySlug(tx, site.id, ""));
    if (!home) throw new Error("test setup: home page not found");
    // Make the draft unpublishable: archive the only home page.
    await withTenantContext(tenant.id, (tx) =>
      updatePageMeta(tx, { id: home.id, status: "archived" }),
    );

    await expect(
      withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id })),
    ).rejects.toThrow(PublishValidationError);

    const published = await withTenantContext(tenant.id, (tx) => getPublishedRevision(tx, site.id));
    expect(published?.revisionNumber).toBe(1);
  });

  it("concurrent publishSite calls on the same site serialize into a strictly increasing revision history, never a lost update", async () => {
    const tenant = await createTenant();
    const site = await seedPublishableSite(tenant.id);

    const results = await Promise.all([
      withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id })),
      withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id })),
    ]);

    const published = await withTenantContext(tenant.id, (tx) => getPublishedRevision(tx, site.id));
    expect(published?.revisionNumber).toBe(2);
    // Exactly one of the two publishes was "first" (no previous revision);
    // the other recorded the first's revision id as its "previous" — never
    // both null (that would mean neither saw the other) and never neither
    // null (that would mean both raced against a third, nonexistent write).
    const nullCount = results.filter((r) => r.previousRevisionId === null).length;
    expect(nullCount).toBe(1);
    const nonNull = results.find((r) => r.previousRevisionId !== null);
    const first = results.find((r) => r.previousRevisionId === null);
    expect(nonNull?.previousRevisionId).toBe(first?.revisionId);
  });
});
