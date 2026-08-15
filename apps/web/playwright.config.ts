import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "@playwright/test";

// This file lives at apps/web/playwright.config.ts; three ".." segments
// (the first strips the filename itself) resolve to the repo root, where
// the shared dev database connection strings live.
loadEnv({ path: path.resolve(fileURLToPath(import.meta.url), "../../../.env") });

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    // "/" 404s for any Host that isn't a seeded, active domain — including
    // the plain "localhost:PORT" this readiness probe uses. "/api/health"
    // is host-agnostic on purpose (see its route file).
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      DATABASE_URL_APP: process.env.DATABASE_URL_APP ?? "",
      DATABASE_URL_RESOLVER: process.env.DATABASE_URL_RESOLVER ?? "",
      ROOT_DOMAIN: process.env.ROOT_DOMAIN ?? "provence360.app",
      NODE_ENV: "development",
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
});
