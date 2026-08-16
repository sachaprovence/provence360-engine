import { expect, test } from "@playwright/test";
import { getPageBySlug, updateBlockProps } from "@provence360/content";
import { publishSite, rollbackSite } from "@provence360/publishing";
import { withTenantContext } from "@provence360/tenant";
import { createPublishingFixture } from "./publishing-fixtures";

// v0.4 — Publishing & Versioning Kernel (see docs/PUBLISHING.md). These
// scenarios exercise the same domain primitives the admin UI's Publish/
// Rollback buttons call (packages/publishing) directly, since apps/web's
// Playwright project only starts *its own* server (see playwright.config.ts)
// and has no route into apps/admin's UI. What's under test either way is
// the invariant that actually matters here: the public runtime renders
// only a published Revision, never the live draft — see
// apps/admin/e2e/publishing.spec.ts for the browser-driven proof that
// clicking the admin's Publish/Rollback/Preview UI does the same thing.
test.describe("Publishing & Versioning Kernel — public runtime", () => {
  test("a site that has never been published 404s — the public runtime never falls back to the draft (Invariant A/B)", async ({
    request,
  }) => {
    const fixture = await createPublishingFixture();

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    expect(response.status()).toBe(404);
  });

  test("editing the draft after a page exists still 404s until the first publish, then the full publish -> edit -> publish -> rollback loop renders exactly what was published at each step", async ({
    request,
  }) => {
    const fixture = await createPublishingFixture();

    // Step: draft exists, nothing published yet -> still 404.
    let response = await request.get("/", { headers: { host: fixture.hostname } });
    expect(response.status()).toBe(404);

    // Publish v1.
    const v1 = await withTenantContext(fixture.tenantId, (tx) =>
      publishSite(tx, { siteId: fixture.siteId }),
    );
    response = await request.get("/", { headers: { host: fixture.hostname } });
    expect(response.status()).toBe(200);
    let body = await response.text();
    expect(body).toContain("Version 1");

    // Edit the draft — the public site must NOT change yet.
    const home = await withTenantContext(fixture.tenantId, (tx) =>
      getPageBySlug(tx, fixture.siteId, ""),
    );
    if (!home) throw new Error("fixture home page missing");
    await withTenantContext(fixture.tenantId, (tx) =>
      updateBlockProps(tx, {
        pageId: home.id,
        blockId: "hero",
        props: { body: { fr: "Version 2 (draft)" } },
      }),
    );
    response = await request.get("/", { headers: { host: fixture.hostname } });
    body = await response.text();
    expect(body).toContain("Version 1");
    expect(body).not.toContain("Version 2");

    // Publish v2 — now the public site changes.
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));
    response = await request.get("/", { headers: { host: fixture.hostname } });
    body = await response.text();
    expect(body).toContain("Version 2 (draft)");
    expect(body).not.toContain("Version 1");

    // Edit the draft again — public site stays on v2, not the new edit.
    await withTenantContext(fixture.tenantId, (tx) =>
      updateBlockProps(tx, {
        pageId: home.id,
        blockId: "hero",
        props: { body: { fr: "Version 3 (draft, unpublished)" } },
      }),
    );
    response = await request.get("/", { headers: { host: fixture.hostname } });
    body = await response.text();
    expect(body).toContain("Version 2 (draft)");
    expect(body).not.toContain("Version 3");

    // Roll back to v1 — the public site reverts, and the unpublished v3
    // draft edit is still not what's live.
    await withTenantContext(fixture.tenantId, (tx) =>
      rollbackSite(tx, { siteId: fixture.siteId, targetRevisionId: v1.revisionId }),
    );
    response = await request.get("/", { headers: { host: fixture.hostname } });
    expect(response.status()).toBe(200);
    body = await response.text();
    expect(body).toContain("Version 1");
    expect(body).not.toContain("Version 2");
    expect(body).not.toContain("Version 3");
  });
});
