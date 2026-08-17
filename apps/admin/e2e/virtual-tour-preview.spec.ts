import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { login } from "./actions";
import {
  SEED_PASSWORD,
  SEED_USERS,
  tenantIdBySlug,
  virtualTourIdByPublicName,
} from "./db-fixtures";

// v0.7.1 — Virtual Tour Experience & Embed Hardening (see
// docs/adr/0020-virtual-tour-experience-hardening.md). Real browser, real
// click, real DOM — the one thing render-page.test.tsx's SSR-level
// assertions and virtual-tour-embed.test.tsx's idle-render assertions
// structurally cannot prove (this repo deliberately carries no
// jsdom/RTL). Drives a fresh Site end-to-end through the real admin UI
// (never the shared seeded villas-cassis fixture other specs mutate — same
// discipline as publishing.spec.ts), building a Property, a VirtualTour,
// and a Page with a `virtual-tour` block, then exercises the click-to-load
// surface on the Preview page — which renders through the exact same
// `@provence360/renderer` code and `VirtualTourEmbed` component the public
// runtime uses (section 16 of the brief: no divergent preview behavior).
// apps/web/e2e/virtual-tour.spec.ts covers the complementary public-runtime
// half at the HTTP level (no real click there — see that file's own note
// on why apps/web e2e can't use `page.goto()` against a per-test hostname).

async function createTourFixtureViaUi(
  page: Page,
  opts: { siteName: string; siteSlug: string; propertyName: string; tourName: string },
) {
  const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
  await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

  await page.goto(`/admin/tenants/${tenantId}/sites`);
  await page.getByLabel("Name").fill(opts.siteName);
  await page.getByLabel("Slug").fill(opts.siteSlug);
  await page.getByRole("button", { name: /create site/i }).click();
  await expect(page.getByText(opts.siteName, { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText(opts.siteName, { exact: true }).click();
  await expect(page.getByRole("heading", { name: opts.siteName })).toBeVisible();
  const siteId = page.url().split("/sites/")[1]?.split("/")[0];
  if (!siteId) throw new Error("could not extract siteId from URL");

  await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/properties`);
  await page.getByLabel("Public name").fill(opts.propertyName);
  await page.getByRole("button", { name: /create property/i }).click();
  await expect(page.getByText(opts.propertyName, { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await page.getByText(opts.propertyName, { exact: true }).click();
  await expect(page.getByRole("heading", { name: opts.propertyName })).toBeVisible();
  const propertyId = page.url().split("/properties/")[1]?.split("/")[0];
  if (!propertyId) throw new Error("could not extract propertyId from URL");

  const tourForm = page.locator("form").filter({ hasText: "Matterport share URL" });
  await tourForm.getByLabel("Internal name").fill(`${opts.tourName} (internal)`);
  await tourForm.getByLabel("Public name").fill(opts.tourName);
  await tourForm
    .getByLabel(/Matterport share URL/)
    .fill(`https://my.matterport.com/show/?m=${opts.siteSlug.replace(/-/g, "").slice(0, 11)}`);
  await tourForm.getByRole("button", { name: /add virtual tour/i }).click();
  const row = page.locator("tr", { hasText: opts.tourName });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.locator("select").selectOption("active");
  await expect(row.locator("select")).toHaveValue("active", { timeout: 10000 });
  const tourId = await virtualTourIdByPublicName(opts.tourName);

  await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/pages`);
  await page.getByLabel("Internal name").fill("Home E2E");
  await page.getByLabel("Type").selectOption("home");
  await page.getByRole("button", { name: /create page/i }).click();
  await expect(page.getByText("Home E2E", { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText("Home E2E", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Blocks" })).toBeVisible();
  await page.getByLabel("Status").selectOption("active");
  await page.getByRole("button", { name: /^save$/i }).click();

  await page.getByTestId("add-block-type").selectOption("virtual-tour");
  await page.getByTestId("add-block-props").fill(JSON.stringify({ tourId }));
  await page.getByRole("button", { name: /add block/i }).click();
  await expect(page.locator("li", { hasText: "virtual-tour@1" })).toHaveCount(1, {
    timeout: 10000,
  });

  return { tenantId, siteId, propertyId, tourId };
}

test.describe("Preview — VirtualTour click-to-load (v0.7.1)", () => {
  test("no iframe exists on load; a click reveals a real iframe with the security attributes intact", async ({
    page,
  }) => {
    const unique = Date.now();
    const { tenantId, siteId } = await createTourFixtureViaUi(page, {
      siteName: `VT Preview E2E ${unique}`,
      siteSlug: `vt-preview-e2e-${unique}`,
      propertyName: `VT Property ${unique}`,
      tourName: `VT Tour ${unique}`,
    });

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/preview`);

    // Privacy (section 9): nothing Matterport-shaped exists before the
    // click — no hidden iframe, no preload.
    await expect(page.locator("iframe")).toHaveCount(0);
    const startButton = page.getByRole("button", { name: "Démarrer la visite virtuelle" });
    await expect(startButton).toBeVisible();

    await startButton.click();

    const iframe = page.locator("iframe");
    await expect(iframe).toHaveCount(1, { timeout: 10000 });
    await expect(iframe).toHaveAttribute("src", /^https:\/\/my\.matterport\.com\/show\/\?m=/);
    await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(iframe).toHaveAttribute("title", /Visite virtuelle/);
    await expect(iframe).toHaveAttribute("allowfullscreen", "");
    // No `sandbox` attribute — the deliberate, documented decision (section
    // 11 of the brief; see docs/adr/0020-virtual-tour-experience-hardening.md).
    await expect(iframe).not.toHaveAttribute("sandbox");
  });

  test("click-to-load works on a mobile viewport with no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const unique = Date.now();
    const { tenantId, siteId } = await createTourFixtureViaUi(page, {
      siteName: `VT Mobile E2E ${unique}`,
      siteSlug: `vt-mobile-e2e-${unique}`,
      propertyName: `VT Mobile Property ${unique}`,
      tourName: `VT Mobile Tour ${unique}`,
    });

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/preview`);
    await expect(page.locator("iframe")).toHaveCount(0);

    // Scoped to the embed's own region (not the whole admin chrome, whose
    // preview banner/table layout is outside this mission's scope): the
    // component itself must never exceed the viewport width, before or
    // after activation, and its reserved footprint must not jump (no CLS
    // — section 7 and 14 of the brief).
    const region = page.getByRole("region", { name: /Visite virtuelle/ });
    const boxBefore = await region.boundingBox();
    expect(boxBefore).not.toBeNull();
    expect(boxBefore!.width).toBeLessThanOrEqual(390);

    await page.getByRole("button", { name: "Démarrer la visite virtuelle" }).click();
    await expect(page.locator("iframe")).toHaveCount(1, { timeout: 10000 });

    const boxAfter = await region.boundingBox();
    expect(boxAfter).not.toBeNull();
    expect(boxAfter!.width).toBeLessThanOrEqual(390);
    expect(boxAfter!.height).toBeCloseTo(boxBefore!.height, 0);
  });

  test("two VirtualTours on the same page load independently — starting one never auto-starts the other", async ({
    page,
  }) => {
    const unique = Date.now();
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    const siteName = `VT Multi E2E ${unique}`;
    const siteSlug = `vt-multi-e2e-${unique}`;
    await page.goto(`/admin/tenants/${tenantId}/sites`);
    await page.getByLabel("Name").fill(siteName);
    await page.getByLabel("Slug").fill(siteSlug);
    await page.getByRole("button", { name: /create site/i }).click();
    await expect(page.getByText(siteName, { exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByText(siteName, { exact: true }).click();
    await expect(page.getByRole("heading", { name: siteName })).toBeVisible();
    const siteId = page.url().split("/sites/")[1]?.split("/")[0];
    if (!siteId) throw new Error("could not extract siteId from URL");

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/properties`);
    const multiPropertyName = `VT Multi Property ${unique}`;
    await page.getByLabel("Public name").fill(multiPropertyName);
    await page.getByRole("button", { name: /create property/i }).click();
    await expect(page.getByText(multiPropertyName, { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await page.getByText(multiPropertyName, { exact: true }).click();
    await expect(page.getByRole("heading", { name: multiPropertyName })).toBeVisible();
    const propertyId = page.url().split("/properties/")[1]?.split("/")[0];
    if (!propertyId) throw new Error("could not extract propertyId from URL");

    const tourForm = page.locator("form").filter({ hasText: "Matterport share URL" });
    const tourNameA = `VT Multi Tour A ${unique}`;
    const tourNameB = `VT Multi Tour B ${unique}`;
    for (const [name, sid] of [
      [tourNameA, "aaaaaaaaaaa"],
      [tourNameB, "bbbbbbbbbbb"],
    ] as const) {
      await tourForm.getByLabel("Internal name").fill(`${name} (internal)`);
      await tourForm.getByLabel("Public name").fill(name);
      await tourForm.getByLabel(/Matterport share URL/).fill(sid);
      await tourForm.getByRole("button", { name: /add virtual tour/i }).click();
      const row = page.locator("tr", { hasText: name });
      await expect(row).toBeVisible({ timeout: 10000 });
      await row.locator("select").selectOption("active");
      await expect(row.locator("select")).toHaveValue("active", { timeout: 10000 });
    }
    const tourIdA = await virtualTourIdByPublicName(tourNameA);
    const tourIdB = await virtualTourIdByPublicName(tourNameB);

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/pages`);
    await page.getByLabel("Internal name").fill("Home E2E");
    await page.getByLabel("Type").selectOption("home");
    await page.getByRole("button", { name: /create page/i }).click();
    await expect(page.getByText("Home E2E", { exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByText("Home E2E", { exact: true }).click();
    await page.getByLabel("Status").selectOption("active");
    await page.getByRole("button", { name: /^save$/i }).click();

    let expectedBlockCount = 0;
    for (const tourId of [tourIdA, tourIdB]) {
      await page.getByTestId("add-block-type").selectOption("virtual-tour");
      await page.getByTestId("add-block-props").fill(JSON.stringify({ tourId }));
      await page.getByRole("button", { name: /add block/i }).click();
      expectedBlockCount += 1;
      await expect(page.locator("li", { hasText: "virtual-tour@1" })).toHaveCount(
        expectedBlockCount,
        { timeout: 10000 },
      );
    }

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/preview`);
    await expect(page.locator("iframe")).toHaveCount(0);

    const startButtons = page.getByRole("button", { name: "Démarrer la visite virtuelle" });
    await expect(startButtons).toHaveCount(2);
    await startButtons.first().click();

    await expect(page.locator("iframe")).toHaveCount(1, { timeout: 10000 });
    // The second tour's own start button is still there, untouched — the
    // first tour's click never cascaded into it (section 15 of the brief).
    await expect(page.getByRole("button", { name: "Démarrer la visite virtuelle" })).toHaveCount(1);
  });
});
