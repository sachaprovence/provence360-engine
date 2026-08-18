import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "@playwright/test";

// This file lives at apps/admin/playwright.config.ts; three ".." segments
// (the first strips the filename itself) resolve to the repo root, where
// the shared dev database connection strings live. These tests run
// against the seeded dev database (see packages/database/src/scripts/seed.ts)
// — run `pnpm db:seed` first, same as apps/web's E2E suite.
loadEnv({ path: path.resolve(fileURLToPath(import.meta.url), "../../../.env") });

const PORT = 3101;

// This sandboxed environment pre-installs a fixed Chromium build outside
// Playwright's own version-pinned download cache (see the repo-level
// environment notes) — unlike apps/web's E2E suite, these tests drive a
// real browser page, not just HTTP requests, so they actually need it.
// Falls through to Playwright's normal browser resolution wherever that
// path doesn't exist (CI, other machines).
const sandboxChromium = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // These tests share one seeded dev database and log in/out through real
  // cookies — running them in parallel would race sessions and audit-log
  // assertions against each other.
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  webServer: {
    // A dev server (Turbopack, on-demand per-route compilation) is
    // noticeably flaky under this suite's rapid, sequential navigation
    // across many distinct dynamic routes — an occasional stray 404 from a
    // request landing mid-compile, gone as soon as the route is warm. A
    // production build removes the on-demand compilation step entirely,
    // which is also more representative of what actually ships.
    command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      DATABASE_URL_APP: process.env.DATABASE_URL_APP ?? "",
      DATABASE_URL_RESOLVER: process.env.DATABASE_URL_RESOLVER ?? "",
      DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH ?? "",
      ROOT_DOMAIN: process.env.ROOT_DOMAIN ?? "provence360.app",
      NODE_ENV: "production",
      // v0.9.1: `NODE_ENV=production` + the default (memory) media
      // storage now fails loudly at first use (a real deployment must
      // never run on non-persistent, non-shared storage) — this E2E
      // server is `next start` for realism (see the comment above), not
      // an actual deployment, so it deliberately opts back in. Never set
      // this in a real environment's own configuration.
      MEDIA_ALLOW_MEMORY_IN_PRODUCTION: "true",
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...(existsSync(sandboxChromium) ? { launchOptions: { executablePath: sandboxChromium } } : {}),
  },
});
