import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMediaAsset, createPage } from "@provence360/content";
import { updateSiteBranding } from "@provence360/sites";
import {
  createSite,
  createTenant,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { isMediaAssetSafeToDelete } from "./media-lifecycle";
import { publishSite } from "./publish";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

function fakeChecksum(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

describe("isMediaAssetSafeToDelete", () => {
  it("a MediaAsset referenced by nothing at all is safe to delete", async () => {
    const tenant = await createTenant();
    const asset = await withTenantContext(tenant.id, (tx) =>
      createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${tenant.id}/media/unused/original`,
        mimeType: "image/jpeg",
        width: 800,
        height: 600,
        checksumSha256: fakeChecksum("a"),
        byteSize: 111,
      }),
    );

    const report = await withTenantContext(tenant.id, (tx) =>
      isMediaAssetSafeToDelete(tx, asset.id),
    );
    expect(report).toEqual({ safe: true, referencedBy: [] });
  });

  it("a MediaAsset referenced by the current DRAFT (a Hero block's backgroundMediaId) is NOT safe to delete", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    const { asset, page } = await withTenantContext(tenant.id, async (tx) => {
      const a = await createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${tenant.id}/media/hero/original`,
        mimeType: "image/jpeg",
        width: 1600,
        height: 900,
        checksumSha256: fakeChecksum("b"),
        byteSize: 222,
      });
      const p = await createPage(tx, {
        siteId: site.id,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        content: [
          {
            id: "hero-1",
            type: "hero",
            version: 1,
            props: { headline: { fr: "Bienvenue" }, backgroundMediaId: a.id },
          },
        ],
      });
      return { asset: a, page: p };
    });

    const report = await withTenantContext(tenant.id, (tx) =>
      isMediaAssetSafeToDelete(tx, asset.id),
    );
    expect(report.safe).toBe(false);
    expect(report.referencedBy).toContainEqual({
      kind: "draft_page",
      siteId: site.id,
      pageId: page.id,
    });
  });

  it("a MediaAsset referenced only by SITE BRANDING (a logo) is NOT safe to delete", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    const asset = await withTenantContext(tenant.id, async (tx) => {
      const a = await createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${tenant.id}/media/logo/original`,
        mimeType: "image/png",
        width: 400,
        height: 400,
        checksumSha256: fakeChecksum("c"),
        byteSize: 333,
      });
      await updateSiteBranding(tx, {
        id: site.id,
        branding: { version: 1, brand: { logo: { mediaId: a.id } } },
      });
      return a;
    });

    const report = await withTenantContext(tenant.id, (tx) =>
      isMediaAssetSafeToDelete(tx, asset.id),
    );
    expect(report.safe).toBe(false);
    expect(report.referencedBy).toContainEqual({ kind: "site_branding", siteId: site.id });
  });

  it("a MediaAsset used ONLY by a historical (no longer live) published Revision is STILL not safe to delete — a rollback could bring it back", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    const { assetA, page } = await withTenantContext(tenant.id, async (tx) => {
      const a = await createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${tenant.id}/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original`,
        mimeType: "image/jpeg",
        width: 1600,
        height: 900,
        checksumSha256: fakeChecksum("d"),
        byteSize: 444,
      });
      const p = await createPage(tx, {
        siteId: site.id,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        content: [
          {
            id: "hero-1",
            type: "hero",
            version: 1,
            props: { headline: { fr: "Bienvenue" }, backgroundMediaId: a.id },
          },
        ],
      });
      return { assetA: a, page: p };
    });

    // Publish once with image A referenced, then edit the draft away from
    // it entirely (a real, unrelated second image B).
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    const assetB = await withTenantContext(tenant.id, async (tx) => {
      const b = await createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${tenant.id}/media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original`,
        mimeType: "image/jpeg",
        width: 1600,
        height: 900,
        checksumSha256: fakeChecksum("e"),
        byteSize: 555,
      });
      const { updateBlockProps } = await import("@provence360/content");
      await updateBlockProps(tx, {
        pageId: page.id,
        blockId: "hero-1",
        props: { headline: { fr: "Bienvenue" }, backgroundMediaId: b.id },
      });
      return b;
    });
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    // Image A is no longer in the draft, and no longer in the *current*
    // published Revision — but Revision #1 (still stored, still
    // roll-back-able) still references it.
    const reportA = await withTenantContext(tenant.id, (tx) =>
      isMediaAssetSafeToDelete(tx, assetA.id),
    );
    expect(reportA.safe).toBe(false);
    expect(reportA.referencedBy).toContainEqual(
      expect.objectContaining({ kind: "revision", siteId: site.id, revisionNumber: 1 }),
    );
    // Image A is not referenced by the current draft — only by the old revision.
    expect(reportA.referencedBy.some((r) => r.kind === "draft_page")).toBe(false);

    // Image B (the current draft AND the current published revision) is
    // also unsafe, for the more obvious reason.
    const reportB = await withTenantContext(tenant.id, (tx) =>
      isMediaAssetSafeToDelete(tx, assetB.id),
    );
    expect(reportB.safe).toBe(false);
  });

  it("never crosses tenant boundaries: tenant B's MediaAsset is judged only against tenant B's own sites/pages/revisions", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    const assetB = await withTenantContext(tenantB.id, (tx) =>
      createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${tenantB.id}/media/only-in-b/original`,
        mimeType: "image/jpeg",
        width: 800,
        height: 600,
        checksumSha256: fakeChecksum("f"),
        byteSize: 666,
      }),
    );

    // Same tenant, correctly resolves.
    const reportB = await withTenantContext(tenantB.id, (tx) =>
      isMediaAssetSafeToDelete(tx, assetB.id),
    );
    expect(reportB.safe).toBe(true);

    // A different tenant's context never sees or is confused by it.
    const reportA = await withTenantContext(tenantA.id, (tx) =>
      isMediaAssetSafeToDelete(tx, assetB.id),
    );
    expect(reportA.safe).toBe(true);
    expect(reportA.referencedBy).toEqual([]);
  });
});
