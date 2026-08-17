import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPage } from "@provence360/content";
import { publishSite } from "@provence360/publishing";
import { updateSiteNavigation } from "@provence360/sites";
import { createDomain, createMediaAsset, createSite, createTenant } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";

// v0.5 — Content & Site Composition Kernel (see docs/PUBLISHING.md). Same
// isolation discipline as publishing.spec.ts: a dedicated tenant/site/domain
// per test, plain inserts only, never `resetDatabase()`.

async function createCompositionFixture() {
  const tenant = await createTenant();
  const site = await createSite({ tenantId: tenant.id });
  const hostname = `composition-e2e-${randomUUID().slice(0, 8)}.test.example`;
  await createDomain({ tenantId: tenant.id, siteId: site.id, hostname, status: "active" });
  return { tenantId: tenant.id, siteId: site.id, hostname };
}

test.describe("Content & Site Composition Kernel — public runtime", () => {
  test("resolved navigation renders on the public page and its internal link resolves to a real, published second page", async ({
    request,
  }) => {
    const fixture = await createCompositionFixture();

    const home = await withTenantContext(fixture.tenantId, (tx) =>
      createPage(tx, {
        siteId: fixture.siteId,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
        content: [{ id: "b1", type: "text", version: 1, props: { body: { fr: "Accueil" } } }],
      }),
    );
    const about = await withTenantContext(fixture.tenantId, (tx) =>
      createPage(tx, {
        siteId: fixture.siteId,
        slug: "about",
        internalName: "About",
        status: "active",
        content: [{ id: "b1", type: "text", version: 1, props: { body: { fr: "À propos" } } }],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) =>
      updateSiteNavigation(tx, {
        id: fixture.siteId,
        navigation: {
          version: 1,
          items: [
            { id: "n-home", label: { fr: "Accueil" }, target: { kind: "page", pageId: home.id } },
            {
              id: "n-about",
              label: { fr: "À propos" },
              target: { kind: "page", pageId: about.id },
            },
          ],
        },
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const homeResponse = await request.get("/", { headers: { host: fixture.hostname } });
    expect(homeResponse.status()).toBe(200);
    const homeBody = await homeResponse.text();
    expect(homeBody).toContain('href="/about"');
    expect(homeBody).toContain("À propos");

    // The internal link genuinely resolves — this is the catch-all route
    // (`app/[[...slug]]/page.tsx`) added in v0.5, not just a schema exercise.
    const aboutResponse = await request.get("/about", { headers: { host: fixture.hostname } });
    expect(aboutResponse.status()).toBe(200);
    const aboutBody = await aboutResponse.text();
    expect(aboutBody).toContain("À propos");
  });

  test("navigation changed in the Draft after publishing stays invisible until the next publish", async ({
    request,
  }) => {
    const fixture = await createCompositionFixture();
    const home = await withTenantContext(fixture.tenantId, (tx) =>
      createPage(tx, {
        siteId: fixture.siteId,
        slug: "",
        internalName: "Home",
        pageType: "home",
        status: "active",
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) =>
      updateSiteNavigation(tx, {
        id: fixture.siteId,
        navigation: {
          version: 1,
          items: [
            {
              id: "n1",
              label: { fr: "Published Link" },
              target: { kind: "page", pageId: home.id },
            },
          ],
        },
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    // Draft navigation changes after publish — must not appear publicly.
    await withTenantContext(fixture.tenantId, (tx) =>
      updateSiteNavigation(tx, {
        id: fixture.siteId,
        navigation: {
          version: 1,
          items: [
            {
              id: "n1",
              label: { fr: "Published Link" },
              target: { kind: "page", pageId: home.id },
            },
            {
              id: "n2",
              label: { fr: "Draft-only Link" },
              target: { kind: "external", href: "/never-published" },
            },
          ],
        },
      }),
    );

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    const body = await response.text();
    expect(body).toContain("Published Link");
    expect(body).not.toContain("Draft-only Link");
  });

  test("an already-published page's frozen media survives a later edit to the same MediaAsset (Invariant: presentation frozen)", async ({
    request,
  }) => {
    const fixture = await createCompositionFixture();
    const asset = await createMediaAsset({
      tenantId: fixture.tenantId,
      storageKey: "e2e/original.jpg",
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
            props: { headline: { fr: "H" }, backgroundMediaId: asset.id },
          },
        ],
      }),
    );
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const { getAdminDb } = await import("@provence360/database/admin");
    const { mediaAssets } = await import("@provence360/database");
    const { eq } = await import("drizzle-orm");
    await getAdminDb()
      .update(mediaAssets)
      .set({ storageKey: "e2e/edited-after-publish.jpg" })
      .where(eq(mediaAssets.id, asset.id));

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    const body = await response.text();
    expect(body).toContain("e2e/original.jpg");
    expect(body).not.toContain("e2e/edited-after-publish.jpg");
  });
});
