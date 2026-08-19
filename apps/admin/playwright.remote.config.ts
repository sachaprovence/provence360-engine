import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// v1.0.2 — brief SUJET K: the ONLY Playwright config in this repo that
// targets a real, already-running remote deployment instead of starting a
// local dev/build server — no `webServer` block at all, deliberately.
// Every other apps/admin Playwright config (playwright.config.ts) exists to
// exercise *this* codebase against a server it starts itself; this one
// exists to prove a specific, already-deployed instance genuinely works —
// see apps/admin/e2e-remote/remote-smoke.spec.ts and docs/RAILWAY.md,
// "Smoke test after deploying."
//
// Required env vars (fails fast, at config-load time, if any is missing —
// see the check below):
//   SMOKE_REMOTE_ADMIN_URL     e.g. https://provence360-admin.up.railway.app
//   SMOKE_REMOTE_PUBLIC_URL    e.g. https://provence360-web.up.railway.app
//   SMOKE_REMOTE_OWNER_EMAIL / SMOKE_REMOTE_OWNER_PASSWORD
//     — an existing owner account (e.g. the one `db:bootstrap-production`
//     created) on the target deployment.
//   SMOKE_REMOTE_TENANT_NAME / SMOKE_REMOTE_SITE_NAME
//     — must match that owner's tenant/site display names exactly.
// Optional:
//   SMOKE_REMOTE_PUBLIC_HOST_HEADER — override the `Host` header sent to
//     SMOKE_REMOTE_PUBLIC_URL. Only needed against a non-Railway stand-in
//     URL (e.g. localhost) whose own hostname isn't a valid multi-label
//     site hostname — see the spec file's own comment.
//
// Usage: pnpm --filter @provence360/admin exec playwright test \
//   --config=playwright.remote.config.ts

for (const required of [
  "SMOKE_REMOTE_ADMIN_URL",
  "SMOKE_REMOTE_PUBLIC_URL",
  "SMOKE_REMOTE_OWNER_EMAIL",
  "SMOKE_REMOTE_OWNER_PASSWORD",
  "SMOKE_REMOTE_TENANT_NAME",
  "SMOKE_REMOTE_SITE_NAME",
]) {
  if (!process.env[required]) {
    throw new Error(
      `playwright.remote.config.ts: missing required environment variable ${required}. ` +
        "See this file's own doc comment for the full list.",
    );
  }
}

const sandboxChromium = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export default defineConfig({
  testDir: "./e2e-remote",
  // Longer than the other Playwright configs in this repo — the final
  // step tolerates a real, reproduced propagation delay after publish
  // (see the spec file's own comment) with up to 30s of bounded polling.
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.SMOKE_REMOTE_ADMIN_URL,
    ...(existsSync(sandboxChromium) ? { launchOptions: { executablePath: sandboxChromium } } : {}),
  },
});
