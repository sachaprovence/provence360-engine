import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMediaAsset, createPage, updateBlockProps } from "@provence360/content";
import {
  createSite,
  createTenant,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { getPublishedRevision } from "./published-revision";
import { publishSite } from "./publish";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

function fakeChecksum(seed: string): string {
  // A 64-char lowercase hex digest — real shape, doesn't need to be a real
  // SHA-256 of anything for this test (which is about the *snapshot
  // freezing* behavior, not re-testing `validateImageBytes`'s own hashing,
  // already covered in packages/media).
  return seed.repeat(64).slice(0, 64);
}

/**
 * The exact scenario brief §12 mandates, explicitly, for media (not just
 * v0.8's already-existing branding A/B test): upload image A, reference it
 * from a Hero block, publish, confirm Public shows A; move the Draft to
 * reference image B; confirm Public *still* shows A (a live edit to the
 * Draft must never leak into an already-published Revision); republish;
 * confirm Public now shows B. This is the core guarantee the whole frozen
 * `MediaDescriptor` manifest (`resolveMediaManifest`) exists to provide —
 * see ADR 0022, "Snapshot/Publishing."
 */
describe("media publication A/B invariant", () => {
  it("Draft references image A -> publish -> public shows A -> draft moves to image B -> public still shows A -> republish -> public shows B", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    const { imageA, imageB, page } = await withTenantContext(tenant.id, async (tx) => {
      const a = await createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${tenant.id}/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original`,
        mimeType: "image/jpeg",
        width: 1600,
        height: 900,
        checksumSha256: fakeChecksum("a"),
        byteSize: 111_111,
      });
      const b = await createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${tenant.id}/media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original`,
        mimeType: "image/jpeg",
        width: 1600,
        height: 900,
        checksumSha256: fakeChecksum("b"),
        byteSize: 222_222,
      });
      const created = await createPage(tx, {
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
      return { imageA: a, imageB: b, page: created };
    });

    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    const afterFirstPublish = await withTenantContext(tenant.id, (tx) =>
      getPublishedRevision(tx, site.id),
    );
    const mediaIdsAfterFirst = (afterFirstPublish?.snapshot.media ?? []).map((m) => m.id);
    expect(mediaIdsAfterFirst).toEqual([imageA.id]);
    expect(afterFirstPublish?.snapshot.media?.[0]?.checksumSha256).toBe(fakeChecksum("a"));

    // Draft moves to image B — the Page's live content now references B.
    await withTenantContext(tenant.id, (tx) =>
      updateBlockProps(tx, {
        pageId: page.id,
        blockId: "hero-1",
        props: { headline: { fr: "Bienvenue" }, backgroundMediaId: imageB.id },
      }),
    );

    // Public must still show A: nothing about editing the Draft (nor the
    // live media_assets rows themselves, which this test never mutates)
    // touches the already-published Revision's own frozen snapshot.
    const stillA = await withTenantContext(tenant.id, (tx) => getPublishedRevision(tx, site.id));
    const mediaIdsStillA = (stillA?.snapshot.media ?? []).map((m) => m.id);
    expect(mediaIdsStillA).toEqual([imageA.id]);
    expect(stillA?.snapshot.media?.[0]?.checksumSha256).toBe(fakeChecksum("a"));

    // Republish freezes a brand-new Revision from the now-current Draft.
    await withTenantContext(tenant.id, (tx) => publishSite(tx, { siteId: site.id }));

    const afterSecondPublish = await withTenantContext(tenant.id, (tx) =>
      getPublishedRevision(tx, site.id),
    );
    const mediaIdsAfterSecond = (afterSecondPublish?.snapshot.media ?? []).map((m) => m.id);
    expect(mediaIdsAfterSecond).toEqual([imageB.id]);
    expect(afterSecondPublish?.snapshot.media?.[0]?.checksumSha256).toBe(fakeChecksum("b"));
  });
});
