import { expect, test } from "@playwright/test";
import { login } from "./actions";
import { SEED_PASSWORD, SEED_USERS } from "./db-fixtures";

test.describe("unauthenticated access", () => {
  test("visiting the tenant switcher redirects to /login", async ({ page }) => {
    await page.goto("/admin/tenants");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("visiting the admin root redirects to /login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("visiting a specific (real) tenant page redirects to /login, not a 500 or a data leak", async ({
    page,
  }) => {
    await page.goto("/admin/tenants/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("login", () => {
  test("rejects an unknown email with a generic error, no enumeration hint", async ({ page }) => {
    await login(page, "nobody@example.test", "whatever-password");
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("rejects a known email with the wrong password, with the same generic error", async ({
    page,
  }) => {
    await login(page, SEED_USERS.alice.email, "definitely-the-wrong-password");
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("succeeds with correct credentials and lands on the tenant switcher", async ({ page }) => {
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\/tenants$/);
    await expect(page.getByText(SEED_USERS.alice.email)).toBeVisible();
  });

  test("an already-authenticated visit to /login redirects straight to the tenant switcher", async ({
    page,
  }) => {
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\/tenants$/);

    await page.goto("/login");
    await expect(page).toHaveURL(/\/admin\/tenants$/);
  });
});

test.describe("logout", () => {
  test("signing out invalidates the session — a later visit to the tenant switcher redirects to /login", async ({
    page,
  }) => {
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\/tenants$/);

    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/admin/tenants");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the cookie itself stops working after logout, even if the browser still has it", async ({
    page,
    context,
  }) => {
    await login(page, SEED_USERS.alice.email, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\/tenants$/);

    const cookiesBeforeLogout = await context.cookies();
    const sessionCookie = cookiesBeforeLogout.find((c) => c.name === "p360_session");
    expect(sessionCookie).toBeDefined();

    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Re-inject the exact same cookie value the server told us to forget —
    // simulates a client that didn't drop it.
    await context.addCookies([sessionCookie!]);
    await page.goto("/admin/tenants");
    await expect(page).toHaveURL(/\/login$/);
  });
});
