import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e/** holds Playwright specs (see playwright.config.ts) — they use
    // Playwright's own `test`/`describe`, not Vitest's, and must never be
    // picked up here.
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**"],
  },
});
