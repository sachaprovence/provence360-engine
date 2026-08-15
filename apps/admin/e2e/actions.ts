import type { Page } from "@playwright/test";

/**
 * Submits the login form and waits for the outcome — either the
 * server-action redirect away from /login (success) or the error message
 * rendering in place (failure) — before returning. `useActionState` forms
 * submit asynchronously (no classic full-page POST), so a bare `.click()`
 * resolves as soon as the click is dispatched, well before the server
 * action's response (and therefore the Set-Cookie header) has actually
 * landed. Every caller that immediately asserts on post-login state (a
 * redirect target, a cookie, an authenticated page) needs this to have
 * actually settled first, or assertions race the network.
 */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  await Promise.race([
    page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 5000 }),
    page.getByText(/invalid email or password|too many attempts/i).waitFor({ timeout: 5000 }),
  ]);
}
