import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPage } from "@provence360/content";
import { publishSite } from "@provence360/publishing";
import { createDomain, createMediaAsset, createSite, createTenant } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";

// v0.8 — Site Theme, Branding & Design System Kernel (see
// docs/adr/0021-site-theme-branding-design-system.md). Same isolation
// discipline and `request`-fixture-over-`page.goto()` reasoning as
// apps/web/e2e/virtual-tour.spec.ts (browsers refuse to let a caller
// override the `Host` header, and this suite needs a distinct hostname
// per test) — proves the closed `--site-*` CSS variable set, the logo/
// favicon, and the draft-vs-published isolation are all real at the
// actual HTTP layer. The real-browser, real-click half (a visible color
// change surviving reload, Preview reflecting it) is proven in
// apps/admin/e2e/site-branding.spec.ts, whose Preview page renders
// through this exact same `@provence360/renderer` code (section 16 of the
// brief: preview and public never diverge).

async function setSiteBranding(siteId: string, branding: unknown) {
  const { getAdminDb } = await import("@provence360/database/admin");
  const { sites } = await import("@provence360/database");
  const { eq } = await import("drizzle-orm");
  await getAdminDb().update(sites).set({ branding }).where(eq(sites.id, siteId));
}

async function createBrandingFixture() {
  const tenant = await createTenant();
  const site = await createSite({ tenantId: tenant.id });
  const hostname = `branding-e2e-${randomUUID().slice(0, 8)}.test.example`;
  await createDomain({ tenantId: tenant.id, siteId: site.id, hostname, status: "active" });
  await withTenantContext(tenant.id, (tx) =>
    createPage(tx, {
      siteId: site.id,
      slug: "",
      internalName: "Home",
      pageType: "home",
      status: "active",
      content: [{ id: "b1", type: "text", version: 1, props: { body: { fr: "v1" } } }],
    }),
  );
  return { tenantId: tenant.id, siteId: site.id, hostname };
}

test.describe("Site Theme, Branding & Design System Kernel — public runtime", () => {
  test("the published page carries the closed --site-* CSS variable set, resolved from the site's branding", async ({
    request,
  }) => {
    const fixture = await createBrandingFixture();
    await setSiteBranding(fixture.siteId, {
      version: 1,
      colors: { primary: "#ab00cd", border: "#334455" },
      typography: { heading: "monospace" },
    });
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    expect(response.status()).toBe(200);
    const body = await response.text();

    expect(body).toContain("--site-color-primary");
    expect(body).toContain("#ab00cd");
    expect(body).toContain("--site-color-border");
    expect(body).toContain("#334455");
    expect(body).toContain("SFMono-Regular");
    // Only the closed variable set — never a raw CSS injection surface.
    // Scoped to a single declaration's value (stops at the next `;`/`"`) so
    // this can't false-positive on unrelated `<script>` tags elsewhere on
    // the page (Next.js's own hydration payload, present on every render).
    expect(body).not.toMatch(/--site-[a-z-]+["\\]*:[^;"]*(javascript:|expression\(|<script)/i);
  });

  test("a site with no branding configured still renders the official default — backward compatible", async ({
    request,
  }) => {
    const fixture = await createBrandingFixture();
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    const body = await response.text();
    expect(body).toContain("--site-color-primary");
    expect(body).toContain("#27272a");
  });

  test("the logo resolves through the frozen media manifest and appears in the public HTML", async ({
    request,
  }) => {
    const fixture = await createBrandingFixture();
    const asset = await createMediaAsset({
      tenantId: fixture.tenantId,
      storageKey: "e2e/brand-logo.png",
      altText: "E2E Villa logo",
    });
    await setSiteBranding(fixture.siteId, {
      version: 1,
      brand: { logo: { mediaId: asset.id } },
    });
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const response = await request.get("/", { headers: { host: fixture.hostname } });
    const body = await response.text();
    expect(body).toContain("e2e/brand-logo.png");
    expect(body).toContain("E2E Villa logo");
  });

  test("a missing/stale logo reference degrades gracefully — no broken image, no publish failure", async ({
    request,
  }) => {
    const fixture = await createBrandingFixture();
    const staleId = "01a00000-0000-7000-8000-00000000dead";
    await setSiteBranding(fixture.siteId, {
      version: 1,
      brand: { logo: { mediaId: staleId } },
    });

    // Publishing itself must succeed despite the stale reference — a
    // missing logo is chrome, not content, and never blocks a publish
    // (see docs/adr/0021-site-theme-branding-design-system.md).
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));
    const response = await request.get("/", { headers: { host: fixture.hostname } });
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(staleId);
  });

  test("modifying the draft branding after publish does not change the public page until republished", async ({
    request,
  }) => {
    const fixture = await createBrandingFixture();
    await setSiteBranding(fixture.siteId, { version: 1, colors: { primary: "#aa0000" } });
    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));

    const before = await request.get("/", { headers: { host: fixture.hostname } });
    expect(await before.text()).toContain("#aa0000");

    await setSiteBranding(fixture.siteId, { version: 1, colors: { primary: "#00bb00" } });

    const stillOld = await request.get("/", { headers: { host: fixture.hostname } });
    const stillOldBody = await stillOld.text();
    expect(stillOldBody).toContain("#aa0000");
    expect(stillOldBody).not.toContain("#00bb00");

    await withTenantContext(fixture.tenantId, (tx) => publishSite(tx, { siteId: fixture.siteId }));
    const after = await request.get("/", { headers: { host: fixture.hostname } });
    expect(await after.text()).toContain("#00bb00");
  });
});
