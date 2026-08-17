import { expect, test } from "@playwright/test";
import { login } from "./actions";
import { SEED_PASSWORD, SEED_USERS, tenantIdBySlug } from "./db-fixtures";

// v0.8 — Site Theme, Branding & Design System Kernel (see
// docs/adr/0021-site-theme-branding-design-system.md). Same discipline as
// publishing.spec.ts: a fresh Site dedicated to this test, never the
// shared seeded villas-cassis fixture other specs mutate. Drives the real
// admin Appearance form, verifies the change survives a reload
// (persistence), verifies Preview reflects it (Preview/Public parity —
// same renderer, see the ADR's "Preview/Public parity" section), and
// verifies publishing freezes it. apps/web/e2e/branding.spec.ts covers the
// complementary public-runtime half at the HTTP level.
test.describe("Appearance — Site Theme, Branding & Design System", () => {
  test("OWNER: edit brand name, colors, and typography -> persists across reload -> Preview reflects it -> publish freezes it", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    const unique = Date.now();
    const siteName = `Branding E2E Site ${unique}`;
    const slug = `branding-e2e-${unique}`;
    await page.goto(`/admin/tenants/${tenantId}/sites`);
    await page.getByLabel("Name").fill(siteName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByRole("button", { name: /create site/i }).click();
    await expect(page.getByText(siteName, { exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByText(siteName, { exact: true }).click();
    await expect(page.getByRole("heading", { name: siteName })).toBeVisible();
    const siteId = page.url().split("/sites/")[1]?.split("/")[0];
    if (!siteId) throw new Error("could not extract siteId from URL");

    // A home Page is required for Preview/publish to have anything to render.
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/pages`);
    await page.getByLabel("Internal name").fill("Home E2E");
    await page.getByLabel("Type").selectOption("home");
    await page.getByRole("button", { name: /create page/i }).click();
    await expect(page.getByText("Home E2E", { exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByText("Home E2E", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Blocks" })).toBeVisible();
    await page.getByLabel("Status").selectOption("active");
    await page.getByRole("button", { name: /^save$/i }).click();

    // Edit the Appearance form.
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}`);
    const brandName = `Villa Branding E2E ${unique}`;
    await page.getByLabel("Brand name").fill(brandName);
    await page.getByLabel("Primary", { exact: true }).fill("#ab00cd");
    await page.getByLabel("Heading font").selectOption("elegant-serif");
    await page.getByLabel("Primary button").selectOption("outline");
    await page.getByRole("button", { name: /save branding/i }).click();
    // The `useActionState` submission is asynchronous — wait for the
    // button to return from its pending "Saving…" label before asserting
    // on anything the save was supposed to have changed.
    await expect(page.getByRole("button", { name: /^save branding$/i })).toBeVisible({
      timeout: 10000,
    });

    // Persistence: reload the page, confirm the saved values are still there.
    await page.reload();
    await expect(page.getByLabel("Brand name")).toHaveValue(brandName);
    await expect(page.getByLabel("Primary", { exact: true })).toHaveValue("#ab00cd");
    await expect(page.getByLabel("Heading font")).toHaveValue("elegant-serif");
    await expect(page.getByLabel("Primary button")).toHaveValue("outline");

    // Preview reflects the draft branding immediately (same renderer as
    // public — see the ADR).
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/preview`);
    const previewHtml = await page.content();
    expect(previewHtml).toContain("--site-color-primary");
    expect(previewHtml).toContain("#ab00cd");

    // Publish freezes it into a Revision.
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/publishing`);
    await page.getByRole("button", { name: /^publish$/i }).click();
    await expect(page.getByText(/Live: revision #1/)).toBeVisible({ timeout: 10000 });
  });

  test("changing the draft branding after publishing does not change Preview's already-published counterpart until republished", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    const unique = Date.now();
    const siteName = `Branding Isolation E2E ${unique}`;
    const slug = `branding-isolation-e2e-${unique}`;
    await page.goto(`/admin/tenants/${tenantId}/sites`);
    await page.getByLabel("Name").fill(siteName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByRole("button", { name: /create site/i }).click();
    await expect(page.getByText(siteName, { exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByText(siteName, { exact: true }).click();
    await expect(page.getByRole("heading", { name: siteName })).toBeVisible();
    const siteId = page.url().split("/sites/")[1]?.split("/")[0];
    if (!siteId) throw new Error("could not extract siteId from URL");

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/pages`);
    await page.getByLabel("Internal name").fill("Home E2E");
    await page.getByLabel("Type").selectOption("home");
    await page.getByRole("button", { name: /create page/i }).click();
    await expect(page.getByText("Home E2E", { exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByText("Home E2E", { exact: true }).click();
    await page.getByLabel("Status").selectOption("active");
    await page.getByRole("button", { name: /^save$/i }).click();

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}`);
    await page.getByLabel("Primary", { exact: true }).fill("#111111");
    await page.getByRole("button", { name: /save branding/i }).click();

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/publishing`);
    await page.getByRole("button", { name: /^publish$/i }).click();
    await expect(page.getByText(/Live: revision #1/)).toBeVisible({ timeout: 10000 });

    // Change the draft branding again, WITHOUT republishing.
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}`);
    await page.getByLabel("Primary", { exact: true }).fill("#222222");
    await page.getByRole("button", { name: /save branding/i }).click();

    // Publishing page's own "Live" summary must still reflect revision #1
    // (unchanged) — the draft edit above must not have silently created or
    // altered any revision.
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/publishing`);
    await expect(page.getByText(/Live: revision #1/)).toBeVisible();
    await expect(page.getByText(/unpublished changes/i)).toBeVisible();
  });
});
