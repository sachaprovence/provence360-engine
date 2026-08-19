import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e/** and e2e-remote/** (v1.0.2) hold Playwright specs
    // (playwright.config.ts / playwright.remote.config.ts) — they use
    // Playwright's own `test`/`describe`, not Vitest's, and must never be
    // picked up here.
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**", "e2e-remote/**"],
  },
});
