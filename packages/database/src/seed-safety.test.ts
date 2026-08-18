import { describe, expect, it } from "vitest";
import { assertSeedSafeTarget } from "./seed-safety";

const DEV_URL = "postgresql://provence360:provence360@localhost:5432/provence360_dev";
const TEST_URL = "postgresql://provence360:provence360@localhost:5432/provence360_test";
const PROD_LOOKING_URL = "postgresql://app:secret@prod-db.internal:5432/provence360";
const AMBIGUOUS_URL = "postgresql://app:secret@some-host.internal:5432/customer_data";

describe("assertSeedSafeTarget — SUJET C fail-closed guard", () => {
  it("allows a dev database (name ends in _dev), NODE_ENV=development, no CI", () => {
    expect(() =>
      assertSeedSafeTarget({ NODE_ENV: "development", DATABASE_URL: DEV_URL }),
    ).not.toThrow();
  });

  it("allows a test database (name ends in _test), NODE_ENV=test, no CI", () => {
    expect(() => assertSeedSafeTarget({ NODE_ENV: "test", DATABASE_URL: TEST_URL })).not.toThrow();
  });

  it("allows any non-production target when CI is detected, even with a database name that doesn't match the dev/test convention", () => {
    expect(() =>
      assertSeedSafeTarget({ NODE_ENV: "test", DATABASE_URL: AMBIGUOUS_URL, CI: "true" }),
    ).not.toThrow();
  });

  it("recognizes CI=1 (numeric form) as well as CI=true", () => {
    expect(() =>
      assertSeedSafeTarget({ NODE_ENV: "development", DATABASE_URL: AMBIGUOUS_URL, CI: "1" }),
    ).not.toThrow();
  });

  it("refuses NODE_ENV=production unconditionally — even against a database named provence360_dev", () => {
    expect(() => assertSeedSafeTarget({ NODE_ENV: "production", DATABASE_URL: DEV_URL })).toThrow(
      /NODE_ENV=production/,
    );
  });

  it("refuses NODE_ENV=production even when CI=true is also set — CI is not an override for production", () => {
    expect(() =>
      assertSeedSafeTarget({ NODE_ENV: "production", DATABASE_URL: DEV_URL, CI: "true" }),
    ).toThrow(/NODE_ENV=production/);
  });

  it("refuses an ambiguous target: non-production NODE_ENV, a database name that doesn't match the dev/test convention, no CI", () => {
    expect(() =>
      assertSeedSafeTarget({ NODE_ENV: "development", DATABASE_URL: AMBIGUOUS_URL }),
    ).toThrow(/not explicitly marked as seed-safe/);
  });

  it("refuses a production-looking database name (no _dev/_test suffix) even with NODE_ENV unset and no CI", () => {
    expect(() => assertSeedSafeTarget({ DATABASE_URL: PROD_LOOKING_URL })).toThrow(
      /not explicitly marked as seed-safe/,
    );
  });

  it("refuses when DATABASE_URL is missing entirely — never assumes safety from absence", () => {
    expect(() => assertSeedSafeTarget({ NODE_ENV: "development" })).toThrow(
      /not explicitly marked as seed-safe/,
    );
  });

  it("refuses when DATABASE_URL is unparseable — never assumes safety from a malformed value", () => {
    expect(() =>
      assertSeedSafeTarget({ NODE_ENV: "development", DATABASE_URL: "not-a-url" }),
    ).toThrow(/not explicitly marked as seed-safe/);
  });

  it("never mentions the raw connection string, user, or password in its error message", () => {
    let caught: unknown;
    try {
      assertSeedSafeTarget({ NODE_ENV: "development", DATABASE_URL: PROD_LOOKING_URL });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toMatch(/secret|app:secret|postgresql:\/\//);
  });

  it("accepts a bare 'dev'/'test' database name too, not only the provence360_ prefix", () => {
    expect(() =>
      assertSeedSafeTarget({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://u:p@host:5432/dev",
      }),
    ).not.toThrow();
    expect(() =>
      assertSeedSafeTarget({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://u:p@host:5432/test",
      }),
    ).not.toThrow();
  });
});
