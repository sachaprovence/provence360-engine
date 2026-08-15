import { expect, test } from "@playwright/test";
import { login } from "./actions";
import { SEED_PASSWORD, SEED_USERS, tenantIdBySlug } from "./db-fixtures";

test.describe("tenant access control", () => {
  test("an OWNER can open their own tenant's dashboard", async ({ page }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.alice.tenantSlug);
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}`);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText(/signed in as/i)).toContainText("owner");
  });

  test("editing the URL to a real tenant id the user has no membership in yields 404, not data", async ({
    page,
  }) => {
    // alice only belongs to provence-sud — try her authenticated session
    // against luberon-retreats' real (seeded, existing) tenant id.
    const otherTenantId = await tenantIdBySlug(SEED_USERS.carla.tenantSlug);
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    const response = await page.goto(`/admin/tenants/${otherTenantId}`);
    expect(response?.status()).toBe(404);
    // The URL alone never reveals whether the tenant exists.
    const body = await page.textContent("body");
    expect(body).not.toContain("Luberon Retreats");
  });

  test("a non-existent (well-formed) tenant id also yields 404 — indistinguishable from 'not yours'", async ({
    page,
  }) => {
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);
    const response = await page.goto("/admin/tenants/ffffffff-ffff-ffff-ffff-ffffffffffff");
    expect(response?.status()).toBe(404);
  });

  test("a malformed tenant id in the URL is refused, not a 500", async ({ page }) => {
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);
    const response = await page.goto("/admin/tenants/not-a-uuid");
    expect(response?.status()).toBe(404);
  });

  test("sub-routes (sites, domains, members, audit) enforce the same per-tenant membership check", async ({
    page,
  }) => {
    const otherTenantId = await tenantIdBySlug(SEED_USERS.carla.tenantSlug);
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);

    for (const sub of ["sites", "domains", "members", "audit"]) {
      const response = await page.goto(`/admin/tenants/${otherTenantId}/${sub}`);
      expect(response?.status(), `${sub} sub-route`).toBe(404);
    }
  });
});

test.describe("permission-gated UI", () => {
  test("a plain MEMBER sees the sites list but no create-site form", async ({ page }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.bob.tenantSlug);
    await login(page, SEED_USERS.bob.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites`);
    await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
    await expect(page.getByRole("button", { name: /create site/i })).toHaveCount(0);
  });

  test("a plain MEMBER sees the members list but no add-member form (member.invite is admin/owner-only)", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.bob.tenantSlug);
    await login(page, SEED_USERS.bob.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/members`);
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(page.getByRole("button", { name: /add member/i })).toHaveCount(0);
  });

  test("a plain MEMBER cannot see the Members or Audit log nav links (read permissions differ per role)", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.bob.tenantSlug);
    await login(page, SEED_USERS.bob.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}`);
    // MEMBER lacks audit.read (see packages/auth/src/permissions.ts) —
    // the nav item must not even render.
    await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  });

  test("a plain MEMBER is refused server-side too, not just UI-hidden, when hitting the audit URL directly", async ({
    page,
  }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.bob.tenantSlug);
    await login(page, SEED_USERS.bob.email, SEED_PASSWORD);

    const response = await page.goto(`/admin/tenants/${tenantId}/audit`);
    expect(response?.status()).toBe(404);
  });

  test("an ADMIN can see and use the create-site form", async ({ page }) => {
    const tenantId = await tenantIdBySlug(SEED_USERS.eve.tenantSlug);
    await login(page, SEED_USERS.eve.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${tenantId}/sites`);
    await expect(page.getByRole("button", { name: /create site/i })).toBeVisible();
  });
});
