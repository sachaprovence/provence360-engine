import { expect, test } from "@playwright/test";
import { login } from "./actions";
import { SEED_PASSWORD, SEED_USERS, tenantIdBySlug } from "./db-fixtures";

test.describe("multi-tenant switching", () => {
  test("a contractor with memberships in two tenants sees both on the switcher page", async ({
    page,
  }) => {
    await login(page, SEED_USERS.eve.email, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\/tenants$/);

    await expect(page.getByText("Provence Sud")).toBeVisible();
    await expect(page.getByText("Luberon Retreats")).toBeVisible();
  });

  test("switching tenants via the dropdown navigates to the other tenant with no data leakage", async ({
    page,
  }) => {
    const provenceSudId = await tenantIdBySlug("provence-sud");
    const luberonId = await tenantIdBySlug("luberon-retreats");

    await login(page, SEED_USERS.eve.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${provenceSudId}`);
    // eve is ADMIN of Provence Sud.
    await expect(page.getByText(/signed in as/i)).toContainText("admin");

    await page.selectOption("#tenant-switcher", luberonId);
    await expect(page).toHaveURL(new RegExp(`/admin/tenants/${luberonId}$`));
    // eve is only a MEMBER of Luberon Retreats — the role shown must
    // change with the tenant, not remain "admin" from the previous page.
    await expect(page.getByText(/signed in as/i)).toContainText("member");
  });

  test("the two tenants' sites lists never mix, even for a user who belongs to both", async ({
    page,
  }) => {
    const provenceSudId = await tenantIdBySlug("provence-sud");
    const luberonId = await tenantIdBySlug("luberon-retreats");

    await login(page, SEED_USERS.eve.email, SEED_PASSWORD);

    await page.goto(`/admin/tenants/${provenceSudId}/sites`);
    await expect(page.getByText("Villas Cassis")).toBeVisible();
    await expect(page.getByText("Mas du Luberon")).toHaveCount(0);

    await page.goto(`/admin/tenants/${luberonId}/sites`);
    await expect(page.getByText("Mas du Luberon")).toBeVisible();
    await expect(page.getByText("Villas Cassis")).toHaveCount(0);
  });
});
