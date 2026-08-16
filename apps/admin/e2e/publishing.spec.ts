import { expect, test } from "@playwright/test";
import { login } from "./actions";
import { SEED_PASSWORD, SEED_USERS, tenantIdBySlug } from "./db-fixtures";

// v0.4 — Publishing & Versioning Kernel (see docs/PUBLISHING.md). Drives
// the actual admin UI in a real browser: create a fresh Site + home Page
// (never the shared seeded villas-cassis fixture other specs mutate),
// publish it, edit the draft, publish again, and roll back — asserting on
// the rendered Publishing page at every step. apps/web/e2e/publishing.spec.ts
// covers the complementary half: that the public runtime actually reflects
// each of these publish/rollback calls and never the draft in between.
test.describe("Publishing UI", () => {
  test("OWNER: unpublished draft -> publish -> edit -> publish again -> rollback, all reflected in the Publishing page", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    // Create a fresh Site dedicated to this test — name AND slug both
    // unique per run, so a leftover row from an earlier (e.g. failed) run
    // can never make a `getByText` lookup ambiguous.
    const unique = Date.now();
    const siteName = `Publishing E2E Site ${unique}`;
    const slug = `publishing-e2e-${unique}`;
    await page.goto(`/admin/tenants/${tenantId}/sites`);
    await page.getByLabel("Name").fill(siteName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByRole("button", { name: /create site/i }).click();
    await expect(page.getByText(siteName, { exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByText(siteName, { exact: true }).click();
    await expect(page.getByRole("heading", { name: siteName })).toBeVisible();
    const siteUrl = page.url();
    const siteId = siteUrl.split("/sites/")[1]?.split("/")[0];
    if (!siteId) throw new Error("could not extract siteId from URL");

    // Create the home Page and mark it active (createPageAction defaults
    // to "draft" — see docs/PUBLISHING.md#what-a-draft-is: only "active"
    // Pages are eligible for the next publish).
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/pages`);
    await page.getByLabel("Internal name").fill("Home E2E");
    await page.getByLabel("Type").selectOption("home");
    await page.getByRole("button", { name: /create page/i }).click();
    await expect(page.getByText("Home E2E", { exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByText("Home E2E", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Blocks" })).toBeVisible();
    await page.getByLabel("Status").selectOption("active");
    await page.getByRole("button", { name: /^save$/i }).click();

    // Add a block so the page has real content to publish.
    await page.getByTestId("add-block-type").selectOption("text");
    await page.getByTestId("add-block-props").fill(JSON.stringify({ body: { fr: "v1" } }));
    await page.getByRole("button", { name: /add block/i }).click();
    await expect(page.locator("li", { hasText: "text@1" })).toHaveCount(1, { timeout: 10000 });

    // Publishing page: not yet published, has unpublished changes.
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/publishing`);
    await expect(page.getByText("Never published.")).toBeVisible();
    await expect(page.getByText(/unpublished changes/i)).toBeVisible();

    // Publish.
    await page.getByRole("button", { name: /^publish$/i }).click();
    await expect(page.getByText(/Live: revision #1/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/matches what.s published/i)).toBeVisible();

    // Preview reflects the draft (same as what was just published).
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/preview`);
    await expect(page.getByText(/Preview of/)).toBeVisible();

    // Edit the draft: the site page's nav badge and the publishing status
    // must both flip back to "has unpublished changes".
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/pages`);
    await page.getByText("Home E2E", { exact: true }).click();
    await page.getByTestId("add-block-type").selectOption("text");
    await page.getByTestId("add-block-props").fill(JSON.stringify({ body: { fr: "v2" } }));
    await page.getByRole("button", { name: /add block/i }).click();
    await expect(page.locator("li", { hasText: "text@1" })).toHaveCount(2, { timeout: 10000 });

    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/publishing`);
    await expect(page.getByText(/unpublished changes/i)).toBeVisible();
    await expect(page.getByText(/Live: revision #1/)).toBeVisible();

    // Publish again -> revision #2.
    await page.getByRole("button", { name: /^publish$/i }).click();
    await expect(page.getByText(/Live: revision #2/)).toBeVisible({ timeout: 10000 });

    // History shows both publishes; Revisions lists #1 and #2.
    await expect(page.getByText("#2").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /roll back to #1/i })).toBeVisible();

    // Roll back to #1.
    await page.getByRole("button", { name: /roll back to #1/i }).click();
    await expect(page.getByText(/Live: revision #1/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("rollback").first()).toBeVisible();
  });

  test("a plain MEMBER sees Publishing read-only — no Publish button, no Rollback button", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.bob.tenantSlug);
    await login(page, SEED_USERS.bob.email, SEED_PASSWORD);

    // "villas-cassis" is already published by `pnpm db:publish-seed`.
    await page.goto(`/admin/tenants/${tenantId}/sites`);
    await page.getByText("Villas Cassis", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Villas Cassis" })).toBeVisible();
    await page.getByRole("link", { name: /^publishing$/i }).click();
    await expect(page.getByText(/Live: revision #/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^publish$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /roll back/i })).toHaveCount(0);
  });
});
