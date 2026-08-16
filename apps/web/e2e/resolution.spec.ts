import { expect, test } from "@playwright/test";

// End-to-end smoke test against a real running Next.js server and the dev
// database (see playwright.config.ts and packages/database/src/scripts/seed.ts
// for the fixture data these assertions depend on: run `pnpm db:seed` first).
// Uses the `request` fixture rather than `page.goto()` because browsers
// treat `Host` as a protected header they refuse to let a caller override —
// Playwright's API request context talks HTTP directly and has no such
// restriction, which is exactly what's needed to exercise hostname-based
// resolution without real DNS.
//
// The v0.3 pipeline under test: Host -> DomainResolver -> Site -> Page ->
// Content -> Domain data -> Theme -> Renderer (docs/RENDERING.md). Both
// seeded sites are rendered by the exact same `packages/renderer` code —
// these assertions exist specifically to prove the two responses differ
// only because the underlying data differs (section 27 of the v0.3
// brief), never because of any per-client component or branch.
test.describe("Host -> DomainResolver -> Site -> Page -> Renderer resolution", () => {
  test("a known, active domain resolves and renders its Site's content, in block order, through the shared theme", async ({
    request,
  }) => {
    const response = await request.get("/", {
      headers: { host: "villas-cassis.provence360.app" },
    });

    expect(response.status()).toBe(200);
    const body = await response.text();

    // Content: real Property/Unit data, not a client-specific component.
    expect(body).toContain("Villa des Oliviers");
    expect(body).toContain("Villa principale");
    expect(body).toContain("Studio annexe");
    expect(body).toContain("Piscine chauffée");

    // Block order: hero, then text, then gallery, then feature-list.
    const heroIndex = body.indexOf("Villa des Oliviers — Cassis, Provence");
    const textIndex = body.indexOf("Bienvenue");
    const galleryIndex = body.indexOf('data-block="gallery"');
    expect(heroIndex).toBeGreaterThan(-1);
    expect(textIndex).toBeGreaterThan(heroIndex);
    expect(galleryIndex).toBeGreaterThan(textIndex);

    // This Site's theme override (docs/adr/0011-theme-token-model.md).
    expect(body).toContain("#6b7f3a");

    // No block ever fails to render on the seeded homepage.
    expect(body).not.toContain('data-block="unrenderable"');
  });

  test("a different known domain resolves to a genuinely different Site, same renderer", async ({
    request,
  }) => {
    const response = await request.get("/", {
      headers: { host: "mas-du-luberon.provence360.app" },
    });

    expect(response.status()).toBe(200);
    const body = await response.text();

    expect(body).toContain("Mas du Luberon");
    expect(body).toContain("Vue sur le Luberon");
    expect(body).not.toContain("Villa des Oliviers");

    // A deliberately different block order (no Gallery/Amenities block at
    // all on this Site — FeatureList comes right after the Hero).
    const heroIndex = body.indexOf("Mas du Luberon — refuge au cœur des collines");
    const featureIndex = body.indexOf("Pourquoi ce mas");
    expect(heroIndex).toBeGreaterThan(-1);
    expect(featureIndex).toBeGreaterThan(heroIndex);
    expect(body).not.toContain('data-block="gallery"');
    expect(body).not.toContain('data-block="amenities"');

    // This Site's own, different theme override on the SAME base theme.
    expect(body).toContain("#3a5f7f");
    expect(body).not.toContain("#6b7f3a");

    expect(body).not.toContain('data-block="unrenderable"');
  });

  test("an unknown host fails cleanly with 404", async ({ request }) => {
    const response = await request.get("/", {
      headers: { host: "this-domain-does-not-exist.example.com" },
    });

    expect(response.status()).toBe(404);
  });
});
