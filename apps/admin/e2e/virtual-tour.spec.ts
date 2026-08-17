import { expect, test } from "@playwright/test";
import { login } from "./actions";
import {
  propertyIdBySlug,
  SEED_PASSWORD,
  SEED_USERS,
  siteIdBySlug,
  tenantIdBySlug,
} from "./db-fixtures";

// v0.7 — Virtual Tour & Immersive Experience Kernel admin scenario (see
// docs/adr/0019-virtual-tour-immersive-kernel.md). Public-embed rendering,
// the Presentation-Frozen/Business-Live boundary, and archive-without-
// republish are already proven at the renderer/publishing level (real
// Postgres, `packages/renderer/src/render-page.test.tsx` and
// `packages/publishing/src/composition.test.ts`) — this spec proves the
// admin CRUD surface itself against the real dev database and a real
// browser: an OWNER can create, activate, and archive a VirtualTour on a
// Property they own, and a plain MEMBER sees it read-only.
test.describe("Admin — VirtualTour CRUD on the Property page", () => {
  test("OWNER can create a Matterport tour, activate it, and archive it", async ({ page }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    const siteId = await siteIdBySlug("villas-cassis");
    const propertyId = await propertyIdBySlug("villa-des-oliviers");
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/properties/${propertyId}`);
    await expect(page.getByRole("heading", { name: "Virtual tours" })).toBeVisible();

    const tourForm = page.locator("form").filter({ hasText: "Matterport share URL" });
    await tourForm.getByLabel("Internal name").fill("E2E Playwright Tour");
    await tourForm.getByLabel("Public name").fill("Visite Playwright E2E");
    await tourForm
      .getByLabel(/Matterport share URL/)
      .fill("https://my.matterport.com/show/?m=e2eplaywri1");
    await tourForm.getByRole("button", { name: /add virtual tour/i }).click();

    const row = page.locator("tr", { hasText: "Visite Playwright E2E" });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.locator("select")).toHaveValue("draft");

    await row.locator("select").selectOption("active");
    await expect(row.locator("select")).toHaveValue("active", { timeout: 10000 });

    await row.locator("select").selectOption("archived");
    await expect(row.locator("select")).toHaveValue("archived", { timeout: 10000 });

    await row.getByRole("button", { name: /remove/i }).click();
    await expect(page.getByText("Visite Playwright E2E")).toHaveCount(0, { timeout: 10000 });
  });

  test("a Unit-scoped tour records its scope correctly", async ({ page }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    const siteId = await siteIdBySlug("villas-cassis");
    const propertyId = await propertyIdBySlug("villa-des-oliviers");
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/properties/${propertyId}`);

    const tourForm = page.locator("form").filter({ hasText: "Matterport share URL" });
    await tourForm.getByLabel("Internal name").fill("E2E Unit Tour");
    await tourForm.getByLabel("Public name").fill("Visite Unite E2E");
    await tourForm.getByLabel(/Matterport share URL/).fill("e2eunittour");
    await tourForm.getByLabel("Scope").selectOption({ label: "Villa principale" });
    await tourForm.getByRole("button", { name: /add virtual tour/i }).click();

    const row = page.locator("tr", { hasText: "Visite Unite E2E" });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText("Villa principale");

    // Clean up so repeated runs stay idempotent.
    await row.getByRole("button", { name: /remove/i }).click();
    await expect(page.getByText("Visite Unite E2E")).toHaveCount(0, { timeout: 10000 });
  });

  test("an invalid Matterport input is rejected with a clear error, no row created", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    const siteId = await siteIdBySlug("villas-cassis");
    const propertyId = await propertyIdBySlug("villa-des-oliviers");
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/properties/${propertyId}`);

    const tourForm = page.locator("form").filter({ hasText: "Matterport share URL" });
    await tourForm.getByLabel("Internal name").fill("Should Not Be Created");
    await tourForm.getByLabel("Public name").fill("Should Not Be Created");
    await tourForm.getByLabel(/Matterport share URL/).fill("https://evil.example/not-matterport");
    await tourForm.getByRole("button", { name: /add virtual tour/i }).click();

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Should Not Be Created")).toHaveCount(0);
  });

  test("a plain MEMBER sees Virtual tours read-only (no create form, no status control)", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.bob.tenantSlug);
    const siteId = await siteIdBySlug("villas-cassis");
    const propertyId = await propertyIdBySlug("villa-des-oliviers");
    await login(page, SEED_USERS.bob.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/properties/${propertyId}`);
    await expect(page.getByRole("heading", { name: "Virtual tours" })).toBeVisible();
    await expect(page.getByRole("button", { name: /add virtual tour/i })).toHaveCount(0);
    await expect(page.getByLabel(/Matterport share URL/)).toHaveCount(0);
  });
});
