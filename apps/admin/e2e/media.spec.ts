import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { login } from "./actions";
import { SEED_PASSWORD, SEED_USERS, tenantIdBySlug } from "./db-fixtures";

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url)) + "/fixtures";
const VALID_JPEG = path.join(FIXTURES_DIR, "test-image.jpg");
const INVALID_FILE = path.join(FIXTURES_DIR, "not-an-image.jpg");

// v0.9 — Media Ingestion, Asset Lifecycle & Delivery Kernel (see
// docs/adr/0022-media-ingestion-asset-delivery.md; brief §34's mandated
// scenario: "login -> tenant -> media -> upload valid JPEG -> processing
// -> MediaAsset created -> select the media -> use it in a page -> preview
// -> publish. Also test an invalid upload."). Drives the real upload
// Server Action end to end, then fetches the resulting delivery URL
// through this same running server process (see apps/web/e2e/media.spec.ts's
// doc comment for why *this* suite, not that one, is where genuine
// same-process byte delivery gets proven).
test.describe("Media Library — upload, picker, publish", () => {
  test("OWNER: upload a valid JPEG -> appears in the grid -> select via the Hero picker -> publish -> Preview serves the real bytes", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    const unique = Date.now();
    const siteName = `Media E2E Site ${unique}`;
    const slug = `media-e2e-${unique}`;
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
    await expect(page.getByRole("heading", { name: "Blocks" })).toBeVisible();
    await page.getByLabel("Status").selectOption("active");
    await page.getByRole("button", { name: /^save$/i }).click();
    const pageUrl = page.url();

    // Upload a real JPEG via the Media Library, with alt text so the
    // picker tile below is uniquely locatable.
    const altText = `E2E Media Photo ${unique}`;
    await page.goto(`/admin/tenants/${tenantId}/media`);
    await page.getByLabel(/image file/i).setInputFiles(VALID_JPEG);
    await page.getByLabel(/alt text/i).fill(altText);
    await page.getByRole("button", { name: /^upload$/i }).click();

    // Processing happens server-side within the Server Action call itself
    // (no polling needed) — the grid re-renders with the new asset once
    // the action resolves. Scoped to *this* upload's own card (by its
    // unique alt text) — this suite reruns against the same persistent
    // dev database, which can accumulate same-named "test-image.jpg"
    // uploads from earlier runs.
    const card = page.getByTestId("media-card").filter({ hasText: altText });
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.getByText("test-image.jpg", { exact: true })).toBeVisible();
    await expect(card.getByText(/300×200/)).toBeVisible();

    // Add a Hero block and select the uploaded image through the picker —
    // no manually-typed MediaAsset UUID anywhere in this flow (brief §18).
    await page.goto(pageUrl);
    await page.getByTestId("add-block-type").selectOption("hero");
    await page
      .getByTestId("add-block-props")
      .fill(JSON.stringify({ headline: { fr: "Bienvenue" } }));
    await page.getByRole("button", { name: /add block/i }).click();
    await expect(page.locator("li", { hasText: "hero@1" })).toHaveCount(1, { timeout: 10000 });

    const heroBlock = page.locator("li", { hasText: "hero@1" });
    await heroBlock.getByRole("button", { name: /choose…/i }).click();
    await heroBlock.getByRole("option", { name: altText }).click();
    await heroBlock.getByRole("button", { name: /save props/i }).click();

    // The textarea (still the single source of truth submitted to the
    // Server Action) now contains the picked backgroundMediaId.
    const propsTextarea = heroBlock.locator("textarea[name='props']");
    await expect(propsTextarea).toContainText("backgroundMediaId", { timeout: 10000 });

    // Publish.
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/publishing`);
    await page.getByRole("button", { name: /^publish$/i }).click();
    await expect(page.getByText(/Live: revision #1/)).toBeVisible({ timeout: 10000 });

    // Preview renders through the exact same renderer as Public (brief
    // §15) — its Hero background resolves to a same-origin /media/ URL.
    await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/preview`);
    const html = await page.content();
    const match = /\/media\/[0-9a-f-]+\/[0-9a-f]{64}\/[a-z]+/.exec(html);
    expect(match).not.toBeNull();

    // Fetch the real delivery URL — genuine, same-process, end-to-end byte
    // delivery (this app's own Preview route + the same upload's storage
    // singleton — see apps/web/e2e/media.spec.ts for why the public-runtime
    // suite can't make this same assertion in this sandboxed environment).
    // Fetched via `page.evaluate` (in-browser `fetch`), not
    // `page.request.get`: the session cookie is `Secure` in this
    // production-mode webServer build, and Chromium's own
    // localhost-over-HTTP exemption for `Secure` cookies applies to real
    // page navigation/fetches but not reliably to Playwright's separate
    // `APIRequestContext` HTTP client — an unrelated tooling quirk, not a
    // production concern (production always serves over real HTTPS).
    const deliveryUrl = match?.[0] ?? "";
    const result = await page.evaluate(async (url) => {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        nosniff: res.headers.get("x-content-type-options"),
        cacheControl: res.headers.get("cache-control"),
        byteLength: buf.byteLength,
      };
    }, deliveryUrl);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.nosniff).toBe("nosniff");
    expect(result.cacheControl).toBe("private, no-store");
    expect(result.byteLength).toBeGreaterThan(0);
  });

  test("uploading a non-image file is rejected with a visible error, and creates no MediaAsset", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/media`);
    await page.getByLabel(/image file/i).setInputFiles(INVALID_FILE);
    await page.getByRole("button", { name: /^upload$/i }).click();

    const formError = page.getByText(/could not be decoded|rejected/i);
    await expect(formError).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("not-an-image.jpg", { exact: true })).not.toBeVisible();
  });
});
