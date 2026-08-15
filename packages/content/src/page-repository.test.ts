import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pages } from "@provence360/database";
import {
  createSite,
  createTenant,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { UnknownBlockError } from "./block-registry";
import {
  BlockNotFoundError,
  InvalidReorderError,
  PageNotFoundError,
  SiteNotFoundError,
} from "./errors";
import {
  addBlock,
  createPage,
  deletePage,
  getPage,
  getPageBySlug,
  listPagesForSite,
  removeBlock,
  reorderBlocks,
  updateBlockProps,
  updatePageMeta,
} from "./page-repository";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("createPage", () => {
  it("creates a page attached to a site owned by the current tenant", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    const page = await withTenantContext(tenant.id, (tx) =>
      createPage(tx, { siteId: site.id, slug: "home", internalName: "Home" }),
    );

    expect(page.tenantId).toBe(tenant.id);
    expect(page.siteId).toBe(site.id);
    expect(page.content).toEqual([]);
  });

  it("refuses to attach a page to another tenant's site", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await createSite({ tenantId: tenantB.id });

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        createPage(tx, { siteId: siteB.id, slug: "stolen", internalName: "Stolen" }),
      ),
    ).rejects.toThrow(SiteNotFoundError);
  });

  it("the composite FK rejects a forged tenant_id even bypassing the repository helper", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await createSite({ tenantId: tenantB.id });

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        tx.insert(pages).values({
          tenantId: tenantA.id,
          siteId: siteB.id,
          slug: "forged",
          internalName: "Forged",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses to create a page holding an invalid block", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    await expect(
      withTenantContext(tenant.id, (tx) =>
        createPage(tx, {
          siteId: site.id,
          slug: "bad",
          internalName: "Bad",
          content: [{ id: "blk_x", type: "does-not-exist", version: 1, props: {} }],
        }),
      ),
    ).rejects.toThrow(UnknownBlockError);
  });

  it("enforces at most one HOME page per site", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    await withTenantContext(tenant.id, (tx) =>
      createPage(tx, { siteId: site.id, slug: "", internalName: "Home", pageType: "home" }),
    );

    await expect(
      withTenantContext(tenant.id, (tx) =>
        createPage(tx, {
          siteId: site.id,
          slug: "home-2",
          internalName: "Home 2",
          pageType: "home",
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("cross-tenant isolation", () => {
  it("a tenant cannot read, update, or delete another tenant's page, even knowing its id", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await createSite({ tenantId: tenantB.id });
    const pageB = await withTenantContext(tenantB.id, (tx) =>
      createPage(tx, { siteId: siteB.id, slug: "b-page", internalName: "B" }),
    );

    const readAttempt = await withTenantContext(tenantA.id, (tx) => getPage(tx, pageB.id));
    expect(readAttempt).toBeNull();

    await expect(
      withTenantContext(tenantA.id, (tx) => updatePageMeta(tx, { id: pageB.id, status: "active" })),
    ).rejects.toThrow(PageNotFoundError);

    await expect(withTenantContext(tenantA.id, (tx) => deletePage(tx, pageB.id))).rejects.toThrow(
      PageNotFoundError,
    );

    const stillThere = await withTenantContext(tenantB.id, (tx) => getPage(tx, pageB.id));
    expect(stillThere).not.toBeNull();
  });

  it("listPagesForSite never returns another tenant's pages", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteA = await createSite({ tenantId: tenantA.id });
    const siteB = await createSite({ tenantId: tenantB.id });

    await withTenantContext(tenantA.id, (tx) =>
      createPage(tx, { siteId: siteA.id, slug: "a", internalName: "A" }),
    );
    await withTenantContext(tenantB.id, (tx) =>
      createPage(tx, { siteId: siteB.id, slug: "b", internalName: "B" }),
    );

    const listA = await withTenantContext(tenantA.id, (tx) => listPagesForSite(tx, siteA.id));
    expect(listA.map((p) => p.slug)).toEqual(["a"]);
  });
});

describe("block mutations", () => {
  async function pageFor(tenantId: string) {
    const site = await createSite({ tenantId });
    return withTenantContext(tenantId, (tx) =>
      createPage(tx, { siteId: site.id, slug: "home", internalName: "Home" }),
    );
  }

  it("addBlock appends a validated block with a stable, generated id", async () => {
    const tenant = await createTenant();
    const page = await pageFor(tenant.id);

    const added = await withTenantContext(tenant.id, (tx) =>
      addBlock(tx, {
        pageId: page.id,
        type: "hero",
        version: 1,
        props: { headline: { fr: "Bonjour" } },
      }),
    );
    expect(added.id).toMatch(/^blk_/);

    const reloaded = await withTenantContext(tenant.id, (tx) => getPage(tx, page.id));
    expect(reloaded?.content as unknown[]).toHaveLength(1);
  });

  it("addBlock refuses an invalid block and leaves the page untouched", async () => {
    const tenant = await createTenant();
    const page = await pageFor(tenant.id);

    await expect(
      withTenantContext(tenant.id, (tx) =>
        addBlock(tx, { pageId: page.id, type: "hero", version: 1, props: { headline: {} } }),
      ),
    ).rejects.toThrow();

    const reloaded = await withTenantContext(tenant.id, (tx) => getPage(tx, page.id));
    expect(reloaded?.content).toEqual([]);
  });

  it("updateBlockProps replaces props on the targeted block only", async () => {
    const tenant = await createTenant();
    const page = await pageFor(tenant.id);
    const heroInstance = await withTenantContext(tenant.id, (tx) =>
      addBlock(tx, {
        pageId: page.id,
        type: "hero",
        version: 1,
        props: { headline: { fr: "V1" } },
      }),
    );
    const textInstance = await withTenantContext(tenant.id, (tx) =>
      addBlock(tx, {
        pageId: page.id,
        type: "text",
        version: 1,
        props: { body: { fr: "unchanged" } },
      }),
    );

    await withTenantContext(tenant.id, (tx) =>
      updateBlockProps(tx, {
        pageId: page.id,
        blockId: heroInstance.id,
        props: { headline: { fr: "V2" } },
      }),
    );

    const reloaded = await withTenantContext(tenant.id, (tx) => getPage(tx, page.id));
    const content = reloaded?.content as Array<{
      id: string;
      props: { headline?: { fr: string }; body?: { fr: string } };
    }>;
    expect(content.find((b) => b.id === heroInstance.id)?.props.headline?.fr).toBe("V2");
    expect(content.find((b) => b.id === textInstance.id)?.props.body?.fr).toBe("unchanged");
  });

  it("updateBlockProps fails cleanly for an unknown block id", async () => {
    const tenant = await createTenant();
    const page = await pageFor(tenant.id);

    await expect(
      withTenantContext(tenant.id, (tx) =>
        updateBlockProps(tx, { pageId: page.id, blockId: "blk_does-not-exist", props: {} }),
      ),
    ).rejects.toThrow(BlockNotFoundError);
  });

  it("removeBlock removes exactly the targeted block", async () => {
    const tenant = await createTenant();
    const page = await pageFor(tenant.id);
    const a = await withTenantContext(tenant.id, (tx) =>
      addBlock(tx, { pageId: page.id, type: "hero", version: 1, props: { headline: { fr: "A" } } }),
    );
    const b = await withTenantContext(tenant.id, (tx) =>
      addBlock(tx, { pageId: page.id, type: "text", version: 1, props: { body: { fr: "B" } } }),
    );

    await withTenantContext(tenant.id, (tx) => removeBlock(tx, { pageId: page.id, blockId: a.id }));

    const reloaded = await withTenantContext(tenant.id, (tx) => getPage(tx, page.id));
    const content = reloaded?.content as Array<{ id: string }>;
    expect(content.map((c) => c.id)).toEqual([b.id]);
  });

  it("reorderBlocks reorders the array to exactly the requested order", async () => {
    const tenant = await createTenant();
    const page = await pageFor(tenant.id);
    const a = await withTenantContext(tenant.id, (tx) =>
      addBlock(tx, { pageId: page.id, type: "hero", version: 1, props: { headline: { fr: "A" } } }),
    );
    const b = await withTenantContext(tenant.id, (tx) =>
      addBlock(tx, { pageId: page.id, type: "text", version: 1, props: { body: { fr: "B" } } }),
    );
    const c = await withTenantContext(tenant.id, (tx) =>
      addBlock(tx, {
        pageId: page.id,
        type: "cta",
        version: 1,
        props: { buttonLabel: { fr: "Go" }, buttonHref: "/x" },
      }),
    );

    await withTenantContext(tenant.id, (tx) =>
      reorderBlocks(tx, { pageId: page.id, orderedBlockIds: [c.id, a.id, b.id] }),
    );

    const reloaded = await withTenantContext(tenant.id, (tx) => getPage(tx, page.id));
    const content = reloaded?.content as Array<{ id: string }>;
    expect(content.map((x) => x.id)).toEqual([c.id, a.id, b.id]);
  });

  it("reorderBlocks refuses a partial or unknown-id list", async () => {
    const tenant = await createTenant();
    const page = await pageFor(tenant.id);
    const a = await withTenantContext(tenant.id, (tx) =>
      addBlock(tx, { pageId: page.id, type: "hero", version: 1, props: { headline: { fr: "A" } } }),
    );
    await withTenantContext(tenant.id, (tx) =>
      addBlock(tx, { pageId: page.id, type: "text", version: 1, props: { body: { fr: "B" } } }),
    );

    // Missing one real id.
    await expect(
      withTenantContext(tenant.id, (tx) =>
        reorderBlocks(tx, { pageId: page.id, orderedBlockIds: [a.id] }),
      ),
    ).rejects.toThrow(InvalidReorderError);

    // Contains an id that doesn't exist on this page.
    await expect(
      withTenantContext(tenant.id, (tx) =>
        reorderBlocks(tx, { pageId: page.id, orderedBlockIds: [a.id, "blk_ghost"] }),
      ),
    ).rejects.toThrow(InvalidReorderError);
  });

  it("a tenant cannot mutate blocks on another tenant's page", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const pageB = await pageFor(tenantB.id);

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        addBlock(tx, {
          pageId: pageB.id,
          type: "hero",
          version: 1,
          props: { headline: { fr: "hack" } },
        }),
      ),
    ).rejects.toThrow(PageNotFoundError);
  });
});

describe("getPageBySlug", () => {
  it("resolves a page by (site, slug), scoped to the current tenant", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    await withTenantContext(tenant.id, (tx) =>
      createPage(tx, { siteId: site.id, slug: "about", internalName: "About" }),
    );

    const found = await withTenantContext(tenant.id, (tx) => getPageBySlug(tx, site.id, "about"));
    expect(found?.internalName).toBe("About");
  });
});
