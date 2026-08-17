import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createMediaAsset,
  createPage,
  getPageBySlug,
  updateBlockProps,
} from "@provence360/content";
import { publishSite } from "@provence360/publishing";
import { createDomain, createSite, createTenant } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";

// v0.9 — Media Ingestion, Asset Lifecycle & Delivery Kernel (see
// docs/adr/0022-media-ingestion-asset-delivery.md). Same isolation
// discipline as branding.spec.ts (a dedicated tenant/site/domain per test,
// `request` fixture over `page.goto()` for the Host-header trick).
//
// KNOWN LIMITATION, documented rather than worked around: this suite's
// `next start` server (apps/web/playwright.config.ts's webServer) and this
// test file itself run as *separate OS processes*. The default
// `MEDIA_STORAGE_PROVIDER=memory` adapter (`MemoryObjectStorage`) is,
// deliberately, an in-process fake — real bytes uploaded through
// `@provence360/media`'s real ingestion pipeline from *this* process are
// never visible to the running server's own storage singleton. A real S3-
// compatible backend (the production path) doesn't have this limitation,
// since the bytes live in genuinely shared external storage; this sandbox
// has no Docker/MinIO available to stand one up for E2E (see ADR 0022's
// own "storage abstraction" section). Consequently, this suite proves
// everything that doesn't require the *bytes themselves* to cross that
// process boundary: the frozen media manifest's URL appears correctly (and
// changes correctly under the A/B invariant) in the rendered HTML, the
// delivery route's input validation and RLS/tenant isolation are real at
// the HTTP layer, and a well-formed request for an object that genuinely
// isn't in *this* process's storage 404s cleanly rather than crashing.
// Genuine same-process byte delivery (a real upload really producing real,
// fetchable bytes) is proven once, end-to-end, in
// apps/admin/e2e/media.spec.ts (whose Preview route lives in the same
// process as its own upload Server Action) — and exhaustively at the unit/
// integration level in packages/media's own real-Postgres test suite.

function fakeChecksum(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

async function createMediaFixture() {
  const tenant = await createTenant();
  const site = await createSite({ tenantId: tenant.id });
  const hostname = `media-e2e-${randomUUID().slice(0, 8)}.test.example`;
  await createDomain({ tenantId: tenant.id, siteId: site.id, hostname, status: "active" });
  return { tenantId: tenant.id, siteId: site.id, hostname };
}

test.describe("Media Ingestion & Delivery Kernel — public runtime", () => {
  test("a Hero block's background image resolves to the same-origin /media/ delivery URL in the rendered HTML", async ({
    request,
  }) => {
    const fixture = await createMediaFixture();
    const asset = await withTenantContext(fixture.tenantId, (tx) =>
      createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${fixture.tenantId}/media/${randomUUID()}/original`,
        mimeType: "image/jpeg",
        width: 1920,
        height: 1080,
        checksumSha256: fakeChecksum("a"),
        byteSize: 999,
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) =>
      createPage(tx, {
        siteId: fixture.siteId,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        content: [
          {
            id: "hero",
            type: "hero",
            version: 1,
            props: { headline: { fr: "Bienvenue" }, backgroundMediaId: asset.id },
          },
        ],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain(`/media/${asset.id}/${fakeChecksum("a")}/`);
  });

  test("publication A/B invariant: draft moves to a new image, public HTML keeps referencing the old one until republished", async ({
    request,
  }) => {
    const fixture = await createMediaFixture();
    const { assetA, assetB } = await withTenantContext(fixture.tenantId, async (tx) => {
      const a = await createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${fixture.tenantId}/media/${randomUUID()}/original`,
        mimeType: "image/jpeg",
        checksumSha256: fakeChecksum("a"),
      });
      const b = await createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${fixture.tenantId}/media/${randomUUID()}/original`,
        mimeType: "image/jpeg",
        checksumSha256: fakeChecksum("b"),
      });
      return { assetA: a, assetB: b };
    });
    await withTenantContext(fixture.tenantId, (tx) =>
      createPage(tx, {
        siteId: fixture.siteId,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        content: [
          {
            id: "hero",
            type: "hero",
            version: 1,
            props: { headline: { fr: "Bienvenue" }, backgroundMediaId: assetA.id },
          },
        ],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const beforeBody = await (
      await request.get("/", { headers: { host: fixture.hostname } })
    ).text();
    expect(beforeBody).toContain(`/media/${assetA.id}/`);

    await withTenantContext(fixture.tenantId, async (tx) => {
      const page = await getPageBySlug(tx, fixture.siteId, "");
      if (!page) throw new Error("page not found");
      await updateBlockProps(tx, {
        pageId: page.id,
        blockId: "hero",
        props: { headline: { fr: "Bienvenue" }, backgroundMediaId: assetB.id },
      });
    });

    const stillOldBody = await (
      await request.get("/", { headers: { host: fixture.hostname } })
    ).text();
    expect(stillOldBody).toContain(`/media/${assetA.id}/`);
    expect(stillOldBody).not.toContain(`/media/${assetB.id}/`);

    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const afterBody = await (
      await request.get("/", { headers: { host: fixture.hostname } })
    ).text();
    expect(afterBody).toContain(`/media/${assetB.id}/`);
    expect(afterBody).not.toContain(`/media/${assetA.id}/`);
  });

  test("the delivery route 404s on malformed URL segments before ever touching the database", async ({
    request,
  }) => {
    const fixture = await createMediaFixture();

    const notAUuid = await request.get(`/media/not-a-uuid/${fakeChecksum("a")}/original`, {
      headers: { host: fixture.hostname },
    });
    expect(notAUuid.status()).toBe(404);

    const badFingerprint = await request.get(
      `/media/${randomUUID()}/not-a-real-fingerprint/original`,
      { headers: { host: fixture.hostname } },
    );
    expect(badFingerprint.status()).toBe(404);

    const badVariant = await request.get(
      `/media/${randomUUID()}/${fakeChecksum("a")}/not-a-real-variant`,
      { headers: { host: fixture.hostname } },
    );
    expect(badVariant.status()).toBe(404);
  });

  test("the delivery route 404s for a real asset whose fingerprint doesn't match (forged/stale URL)", async ({
    request,
  }) => {
    const fixture = await createMediaFixture();
    const asset = await withTenantContext(fixture.tenantId, (tx) =>
      createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${fixture.tenantId}/media/${randomUUID()}/original`,
        mimeType: "image/jpeg",
        checksumSha256: fakeChecksum("a"),
      }),
    );

    const response = await request.get(`/media/${asset.id}/${fakeChecksum("f")}/original`, {
      headers: { host: fixture.hostname },
    });
    expect(response.status()).toBe(404);
  });

  test("the delivery route never leaks tenant B's media through tenant A's site", async ({
    request,
  }) => {
    const fixtureA = await createMediaFixture();
    const tenantB = await createTenant();
    const assetB = await withTenantContext(tenantB.id, (tx) =>
      createMediaAsset(tx, {
        kind: "image",
        storageKey: `tenants/${tenantB.id}/media/${randomUUID()}/original`,
        mimeType: "image/jpeg",
        checksumSha256: fakeChecksum("b"),
      }),
    );

    // Requested through tenant A's own hostname/site — the delivery route
    // resolves tenant from the Host header (same as the rest of the public
    // runtime), never from the URL itself.
    const response = await request.get(`/media/${assetB.id}/${fakeChecksum("b")}/original`, {
      headers: { host: fixtureA.hostname },
    });
    expect(response.status()).toBe(404);
  });
});
