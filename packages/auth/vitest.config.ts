import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // Every test file shares one Postgres test database and resets it via
    // TRUNCATE (packages/testkit). Running files in parallel would let one
    // file's reset wipe data another file's test is mid-use of.
    fileParallelism: false,
  },
});
