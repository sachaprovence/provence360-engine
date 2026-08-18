import { beforeAll, describe, expect, it } from "vitest";
import { loadDotEnv } from "./load-env";
import { checkDatabaseHealth } from "./health";

beforeAll(() => {
  loadDotEnv();
});

describe("checkDatabaseHealth", () => {
  it("reports ok:true with a latency when the database is reachable", async () => {
    const result = await checkDatabaseHealth();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("reports ok:false with a short, connection-string-free reason when the database is unreachable", async () => {
    const original = process.env.DATABASE_URL_RESOLVER;
    process.env.DATABASE_URL_RESOLVER =
      "postgresql://provence360_resolver:provence360_resolver@127.0.0.1:1/nope";
    try {
      const result = await checkDatabaseHealth();
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBeUndefined();
      expect(result.error).toBe("database unreachable");
      // The point of the test: whatever went wrong, the raw driver error
      // (which could echo the connection string, including its password)
      // never reaches the caller.
      expect(result.error).not.toContain("provence360_resolver");
    } finally {
      process.env.DATABASE_URL_RESOLVER = original;
    }
  }, 10_000);
});
