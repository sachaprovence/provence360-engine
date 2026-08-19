import { expect, test } from "@playwright/test";
import { login } from "../e2e/actions";

// v1.0.2 — brief SUJET K: a real, non-destructive-enough-to-repeat smoke
// test against an ALREADY DEPLOYED instance — the login helper is the same
// one apps/admin/e2e/*.spec.ts already uses against a local build, reused
// verbatim rather than reimplemented, so this exercises the exact same
// selectors/timing assumptions as the suite that's already run in CI on
// every push (see .github/workflows/ci.yml). Only run via
// playwright.remote.config.ts (see that file for the required env vars) —
// never picked up by the default `pnpm test:e2e`.
//
// This is the one piece of SUJET K/§21's mandated remote validation this
// repository can define but NOT itself execute: it needs a real Railway
// deployment URL, which does not exist in this development environment.
// It WAS exercised end-to-end against a local `next start` build standing
// in for "a real deployment" (same code path, `SMOKE_REMOTE_ADMIN_URL`
// pointed at http://localhost instead of a Railway domain) — see this
// release's final report, SMOKE TESTS, for that real run's output.
//
// Every step below fails the test (non-zero exit) on any unexpected
// response — no `.catch()` that swallows a failure, no artificial `|| true`.
test.describe("Remote deployment smoke test", () => {
  test("health checks, login, create + publish a page, public site serves it", async ({
    page,
    request,
  }) => {
    const adminUrl = process.env.SMOKE_REMOTE_ADMIN_URL as string;
    const publicUrl = process.env.SMOKE_REMOTE_PUBLIC_URL as string;
    const ownerEmail = process.env.SMOKE_REMOTE_OWNER_EMAIL as string;
    const ownerPassword = process.env.SMOKE_REMOTE_OWNER_PASSWORD as string;
    const tenantName = process.env.SMOKE_REMOTE_TENANT_NAME as string;
    const siteName = process.env.SMOKE_REMOTE_SITE_NAME as string;

    await test.step("health checks", async () => {
      const live = await request.get(new URL("/health/live", adminUrl).toString());
      expect(live.status(), "GET /health/live").toBe(200);
      const ready = await request.get(new URL("/health/ready", adminUrl).toString());
      expect(ready.status(), "GET /health/ready").toBe(200);
    });

    await test.step("login", async () => {
      await login(page, ownerEmail, ownerPassword);
      expect(page.url(), "should have navigated away from /login").not.toContain("/login");
    });

    let siteUrl = "";
    await test.step("navigate to the bootstrapped tenant and site", async () => {
      await page.goto("/admin/tenants");
      await expect(page.getByText(tenantName, { exact: true })).toBeVisible({ timeout: 10_000 });
      await page.getByText(tenantName, { exact: true }).click();
      await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({
        timeout: 10_000,
      });
      const tenantId = page.url().split("/tenants/")[1]?.split("/")[0];
      if (!tenantId) throw new Error(`could not extract tenantId from URL ${page.url()}`);

      await page.goto(`/admin/tenants/${tenantId}/sites`);
      await expect(page.getByText(siteName, { exact: true })).toBeVisible({ timeout: 10_000 });
      await page.getByText(siteName, { exact: true }).click();
      await expect(page.getByRole("heading", { name: siteName })).toBeVisible({ timeout: 10_000 });
      siteUrl = page.url();
    });

    // v1.0.2 — real, reproduced finding (see this release's final report,
    // ANOMALIES DÉCOUVERTES): a site can never be published at all until it
    // has an active home page ("The site has no active home page — the
    // public runtime has nothing to render at '/'" — the Publishing page's
    // own validation message). The FIRST time this suite runs against a
    // freshly bootstrapped site (zero pages), it must create that home page
    // itself. On every later run against the SAME site, `pages_site_home_uidx`
    // (see packages/content/src/page-repository.test.ts) enforces at most
    // one home page per site — so a later run adds a "standard" page
    // instead, which publishes fine once a home page already exists.
    // Reusing/mutating the real home page on every run would make this
    // suite non-idempotent and would perturb the very site an operator is
    // trying to observe, not just check it.
    const marker = `remote-smoke-${Date.now()}`;
    let publicPath = "";
    await test.step("create a page (home if none exists yet, else standard) with a real, uniquely-marked block", async () => {
      const [tenantId, siteId] = siteUrl.split("/tenants/")[1]?.split("/sites/") ?? [];
      if (!tenantId || !siteId) throw new Error(`could not parse tenant/site from ${siteUrl}`);

      await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/pages`);
      const hasHomePage = (await page.locator("td", { hasText: "home" }).count()) > 0;
      const pageType = hasHomePage ? "standard" : "home";
      const slug = marker;
      publicPath = pageType === "home" ? "" : slug;

      const pageName = `Remote Smoke ${marker}`;
      await page.getByLabel("Internal name").fill(pageName);
      await page.getByLabel("Slug (ignored for \"home\")").fill(slug);
      await page.getByLabel("Type").selectOption(pageType);
      await page.getByRole("button", { name: /create page/i }).click();
      await expect(page.getByText(pageName, { exact: true })).toBeVisible({ timeout: 10_000 });
      await page.getByText(pageName, { exact: true }).click();
      await expect(page.getByRole("heading", { name: "Blocks" })).toBeVisible();
      await page.getByLabel("Status").selectOption("active");
      await page.getByRole("button", { name: /^save$/i }).click();

      await page.getByTestId("add-block-type").selectOption("text");
      await page.getByTestId("add-block-props").fill(JSON.stringify({ body: { fr: marker } }));
      await page.getByRole("button", { name: /add block/i }).click();
      await expect(page.locator("li", { hasText: "text@1" })).toHaveCount(1, { timeout: 10_000 });

      await page.goto(`/admin/tenants/${tenantId}/sites/${siteId}/publishing`);
      await page.getByRole("button", { name: /^publish$/i }).click();
      await expect(page.getByText(/Live: revision #\d+/)).toBeVisible({ timeout: 10_000 });
    });

    await test.step("public site serves the published revision", async () => {
      // v1.0.2 — SUJET F/K: `SMOKE_REMOTE_PUBLIC_HOST_HEADER` lets an
      // operator send a different `Host` than `publicUrl`'s own hostname —
      // needed only when testing against a bare IP/localhost-style URL
      // whose own hostname can never be a valid multi-label site hostname
      // (see packages/validation/src/hostname.ts's own `normalizeHostname`,
      // which requires at least two dot-separated labels). Against a real
      // Railway `*.up.railway.app` URL this is never needed — the URL's own
      // hostname already matches the `domains` row `db:bootstrap-production`
      // created for it.
      const hostHeader = process.env.SMOKE_REMOTE_PUBLIC_HOST_HEADER;
      const pageUrl = new URL(publicPath, publicUrl).toString();

      // Bounded polling, not an immediate single check: a real deployment
      // can sit behind a reverse proxy / edge cache whose own propagation
      // window this suite has no control over. This still fails hard
      // (non-zero exit) if the page never becomes reachable within the
      // bound — it tolerates real infrastructure lag, it does not mask a
      // failure. (An earlier version of this suite hit a real, different
      // bug here — publishing was silently impossible because the site had
      // no home page yet, which looked like a slow-to-propagate 404 until
      // it was root-caused; see the "create a page" step above and this
      // release's final report, ANOMALIES DÉCOUVERTES, for that story.)
      let response = await request.get(pageUrl, { headers: hostHeader ? { host: hostHeader } : {} });
      const deadline = Date.now() + 30_000;
      while (response.status() !== 200 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        response = await request.get(pageUrl, { headers: hostHeader ? { host: hostHeader } : {} });
      }
      expect(response.status(), `GET ${pageUrl}`).toBe(200);
      const body = await response.text();
      expect(body, "published block content should be present on the public page").toContain(
        marker,
      );
    });
  });
});
