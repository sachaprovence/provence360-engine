import { expect, test } from "@playwright/test";
import { login } from "./actions";
import {
  homePageIdForSite,
  propertyIdBySlug,
  SEED_PASSWORD,
  SEED_USERS,
  siteIdBySlug,
  tenantIdBySlug,
} from "./db-fixtures";

// v0.3 — Site Domain, Content Graph & Rendering Contracts (see
// docs/SITE_DOMAIN.md, docs/CONTENT_MODEL.md). These scenarios prove the
// minimal Site Editor against the real seeded dev database: an OWNER can
// edit their own Site's pages/blocks/properties/units, cannot reach
// another tenant's Site through the URL. Since v0.4 (see
// docs/PUBLISHING.md), what's edited here is the DRAFT — it never reaches
// apps/web until an OWNER/ADMIN explicitly publishes it (see
// apps/admin/e2e/publishing.spec.ts and apps/web/e2e/publishing.spec.ts).
test.describe("Site Editor — pages and blocks", () => {
  test("OWNER can view a Site's pages and open the block editor", async ({ page }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    const siteId = await siteIdBySlug("villas-cassis");
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/pages`);
    await expect(page.getByRole("heading", { name: "Pages" })).toBeVisible();
    await expect(page.getByText("Accueil — Villa des Oliviers")).toBeVisible();

    await page.getByText("Accueil — Villa des Oliviers").click();
    await expect(page.getByRole("heading", { name: "Blocks" })).toBeVisible();
    // Scoped to the block list itself — "hero@1" and "property-summary@1"
    // also appear as <option> values in the "add a block" type picker.
    const blockList = page.getByRole("list");
    await expect(blockList.getByText("hero@1")).toBeVisible();
    await expect(blockList.getByText("property-summary@1")).toBeVisible();
  });

  test("OWNER can create a new page", async ({ page }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    const siteId = await siteIdBySlug("villas-cassis");
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/pages`);
    await page.getByLabel("Internal name").fill("Contact E2E");
    await page.getByLabel(/Slug/).fill("contact-e2e");
    await page.getByLabel("Type").selectOption("contact");
    await page.getByRole("button", { name: /create page/i }).click();

    await expect(page.getByText("Contact E2E")).toBeVisible({ timeout: 10000 });
  });

  test("OWNER can add a block, edit its props, and reorder it — changes are live immediately", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    const siteId = await siteIdBySlug("villas-cassis");
    const pageId = await homePageIdForSite(siteId);
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/pages/${pageId}`);

    // The block list already has one seeded "text@1" block.
    const textBlocksBefore = page.locator("li", { hasText: "text@1" });
    await expect(textBlocksBefore).toHaveCount(1);

    // Add a second "text" block.
    await page.getByTestId("add-block-type").selectOption("text");
    await page
      .getByTestId("add-block-props")
      .fill(JSON.stringify({ body: { fr: "Bloc ajouté par le test E2E." } }));
    await page.getByRole("button", { name: /add block/i }).click();

    // The block list must have grown — two "text@1" instances now.
    const textBlocksAfter = page.locator("li", { hasText: "text@1" });
    await expect(textBlocksAfter).toHaveCount(2, { timeout: 10000 });
  });

  test("OWNER cannot reach another tenant's Site or Page — 404, not data", async ({ page }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    const otherSiteId = await siteIdBySlug("mas-du-luberon");
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    // Alice's own tenant id, but Beta's siteId — the site lookup is
    // tenant-scoped (RLS), so this must 404, not leak Beta's data.
    const response = await page.goto(`/admin/tenants/${tenantId}/sites/${otherSiteId}`);
    expect(response?.status()).toBe(404);
    const body = await page.textContent("body");
    expect(body).not.toContain("Mas du Luberon");
  });
});

test.describe("Site Editor — properties, units, amenities", () => {
  test("OWNER can view a Property's Units and open a Unit's amenities", async ({ page }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    const siteId = await siteIdBySlug("villas-cassis");
    const propertyId = await propertyIdBySlug("villa-des-oliviers");
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/properties/${propertyId}`);
    await expect(page.getByRole("heading", { name: "Villa des Oliviers" })).toBeVisible();
    // Scoped to the Units table's own link — v0.7 added a "Virtual tours"
    // Scope <select> further down the same page whose <option> values are
    // Unit names, so an unscoped text match against "Villa principale" is
    // now ambiguous between the two.
    await expect(page.getByRole("link", { name: "Villa principale" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Studio annexe" })).toBeVisible();

    await page.getByRole("link", { name: "Villa principale" }).click();
    await expect(page.getByRole("heading", { name: "Amenities" })).toBeVisible();
    // Exact match including the category suffix — the platform-level
    // amenity catalog (packages/rentals' `listAmenities`) is global, not
    // tenant-scoped, so it can gain more rows over time (including from
    // other e2e specs' fixtures); a plain substring match on the label
    // alone would become ambiguous as soon as a second catalog entry
    // shares a similarly-cased label.
    await expect(page.getByText("Piscine chauffée(wellness)", { exact: true })).toBeVisible();
  });

  test("a plain MEMBER sees Properties read-only (no create-property form)", async ({ page }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.bob.tenantSlug);
    const siteId = await siteIdBySlug("villas-cassis");
    await login(page, SEED_USERS.bob.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/properties`);
    await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();
    await expect(page.getByRole("button", { name: /create property/i })).toHaveCount(0);
  });

  test("a plain MEMBER sees Pages read-only (no create-page form) and cannot edit blocks server-side", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.bob.tenantSlug);
    const siteId = await siteIdBySlug("villas-cassis");
    const pageId = await homePageIdForSite(siteId);
    await login(page, SEED_USERS.bob.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/pages`);
    await expect(page.getByRole("heading", { name: "Pages" })).toBeVisible();
    await expect(page.getByRole("button", { name: /create page/i })).toHaveCount(0);

    // page.read is granted to MEMBER, so the editor itself still opens —
    // but no mutating form (props textarea, add-block picker) renders.
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/pages/${pageId}`);
    await expect(page.getByRole("heading", { name: "Blocks" })).toBeVisible();
    await expect(page.getByTestId("add-block-type")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /save props/i })).toHaveCount(0);
  });
});

test.describe("Site Editor — theme", () => {
  test("OWNER can select a theme and set a narrow override", async ({ page }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.carla.tenantSlug);
    const siteId = await siteIdBySlug("mas-du-luberon");
    await login(page, SEED_USERS.carla.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}`);
    await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
    await expect(page.locator('textarea[name="themeOverrides"]')).toBeVisible();
  });
});
