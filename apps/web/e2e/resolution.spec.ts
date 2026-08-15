import { expect, test } from "@playwright/test";

// End-to-end smoke test against a real running Next.js server and the dev
// database (see playwright.config.ts and packages/database/src/scripts/seed.ts
// for the fixture data these assertions depend on: run `pnpm db:seed` first).
// Uses the `request` fixture rather than `page.goto()` because browsers
// treat `Host` as a protected header they refuse to let a caller override —
// Playwright's API request context talks HTTP directly and has no such
// restriction, which is exactly what's needed to exercise hostname-based
// resolution without real DNS.

test.describe("Host -> DomainResolver -> Site -> Tenant resolution", () => {
  test("a known, active domain resolves and renders its site", async ({ request }) => {
    const response = await request.get("/", {
      headers: { host: "villas-cassis.provence360.app" },
    });

    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("Villas Cassis");
    expect(body).toContain("Provence Sud");
  });

  test("a different known domain resolves to a different site", async ({ request }) => {
    const response = await request.get("/", {
      headers: { host: "mas-du-luberon.provence360.app" },
    });

    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("Mas du Luberon");
    expect(body).toContain("Luberon Retreats");
  });

  test("an unknown host fails cleanly with 404", async ({ request }) => {
    const response = await request.get("/", {
      headers: { host: "this-domain-does-not-exist.example.com" },
    });

    expect(response.status()).toBe(404);
  });
});
