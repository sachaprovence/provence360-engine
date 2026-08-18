import { describe, expect, it } from "vitest";
import {
  dbEnvSchema,
  findDangerousProductionConfig,
  loadDbEnv,
  loadEnv,
  loadMediaEnv,
  mediaEnvSchema,
  platformEnvSchema,
} from "./env";

const VALID_DB_ENV = {
  DATABASE_URL: "postgresql://user:pass@db-host:5432/prod",
  DATABASE_URL_APP: "postgresql://app_role:app_pass@db-host:5432/prod",
  DATABASE_URL_RESOLVER: "postgresql://resolver_role:resolver_pass@db-host:5432/prod",
  DATABASE_URL_AUTH: "postgresql://auth_role:auth_pass@db-host:5432/prod",
};

describe("loadEnv / loadDbEnv / loadMediaEnv — missing and invalid variables", () => {
  it("throws a descriptive error when a required DB variable is absent", () => {
    expect(() => loadDbEnv({})).toThrow(/DATABASE_URL/);
  });

  it("throws when a DB URL has the wrong scheme", () => {
    expect(() => loadDbEnv({ ...VALID_DB_ENV, DATABASE_URL: "mysql://user:pass@host/db" })).toThrow(
      /postgresql:\/\//,
    );
  });

  it("throws when ROOT_DOMAIN contains a scheme or port", () => {
    expect(() =>
      platformEnvSchema.parse({ ROOT_DOMAIN: "https://example.com", NODE_ENV: "production" }),
    ).toThrow();
  });

  it("throws when MEDIA_STORAGE_PROVIDER=s3 is missing its required S3_* variables", () => {
    expect(() => loadMediaEnv({ MEDIA_STORAGE_PROVIDER: "s3" })).toThrow(/S3_REGION/);
  });
});

describe("loadEnv / loadDbEnv / loadMediaEnv — valid configurations per environment", () => {
  it("accepts a valid development configuration", () => {
    const env = loadEnv({
      ...VALID_DB_ENV,
      ROOT_DOMAIN: "provence360.app",
      NODE_ENV: "development",
    });
    expect(env.NODE_ENV).toBe("development");
  });

  it("accepts a valid test configuration", () => {
    const env = loadEnv({ ...VALID_DB_ENV, ROOT_DOMAIN: "provence360.app", NODE_ENV: "test" });
    expect(env.NODE_ENV).toBe("test");
  });

  it("accepts a valid production configuration with real S3 storage", () => {
    const env = loadEnv({
      ...VALID_DB_ENV,
      ROOT_DOMAIN: "provence360.app",
      NODE_ENV: "production",
    });
    const media = loadMediaEnv({
      MEDIA_STORAGE_PROVIDER: "s3",
      S3_REGION: "us-east-1",
      S3_BUCKET: "prod-bucket",
      S3_ACCESS_KEY_ID: "AKIA...",
      S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(env.NODE_ENV).toBe("production");
    expect(media.MEDIA_STORAGE_PROVIDER).toBe("s3");
  });

  it("defaults NODE_ENV to development and MEDIA_STORAGE_PROVIDER to memory when unset", () => {
    expect(platformEnvSchema.parse({ ROOT_DOMAIN: "provence360.app" }).NODE_ENV).toBe(
      "development",
    );
    expect(mediaEnvSchema.parse({}).MEDIA_STORAGE_PROVIDER).toBe("memory");
  });
});

describe("findDangerousProductionConfig", () => {
  const BASE = {
    ...VALID_DB_ENV,
    ROOT_DOMAIN: "provence360.app",
    NODE_ENV: "production" as const,
    MEDIA_STORAGE_PROVIDER: "s3" as const,
    MEDIA_ALLOW_MEMORY_IN_PRODUCTION: false,
  };

  it("reports nothing for a clean, fully-configured production environment", () => {
    expect(findDangerousProductionConfig(BASE)).toEqual({ errors: [], warnings: [] });
  });

  it("never flags anything outside production, no matter how it's configured", () => {
    expect(
      findDangerousProductionConfig({
        NODE_ENV: "development",
        MEDIA_STORAGE_PROVIDER: "memory",
        DATABASE_URL: "postgresql://provence360:provence360@localhost:5432/provence360_dev",
        ROOT_DOMAIN: "localhost",
      }),
    ).toEqual({ errors: [], warnings: [] });
  });

  it("errors on NODE_ENV=production with the default (memory) storage and no escape hatch", () => {
    const report = findDangerousProductionConfig({ ...BASE, MEDIA_STORAGE_PROVIDER: "memory" });
    expect(report.errors).toEqual([expect.stringMatching(/MEDIA_STORAGE_PROVIDER=memory/)]);
  });

  it("warns (does not error) when MEDIA_ALLOW_MEMORY_IN_PRODUCTION=true is deliberately set", () => {
    const report = findDangerousProductionConfig({
      ...BASE,
      MEDIA_STORAGE_PROVIDER: "memory",
      MEDIA_ALLOW_MEMORY_IN_PRODUCTION: true,
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([
      expect.stringMatching(/MEDIA_ALLOW_MEMORY_IN_PRODUCTION=true/),
    ]);
  });

  it("errors when a production DATABASE_URL still uses the checked-in dev/CI credentials", () => {
    const report = findDangerousProductionConfig({
      ...BASE,
      DATABASE_URL_APP:
        "postgresql://provence360_app:provence360_app@prod-host:5432/provence360_dev",
    });
    expect(report.errors).toEqual([expect.stringMatching(/development\/CI default credentials/)]);
  });

  it("errors when ROOT_DOMAIN is localhost in production", () => {
    const report = findDangerousProductionConfig({ ...BASE, ROOT_DOMAIN: "localhost" });
    expect(report.errors).toEqual([expect.stringMatching(/ROOT_DOMAIN="localhost"/)]);
  });

  it("can report multiple independent problems at once", () => {
    const report = findDangerousProductionConfig({
      ...BASE,
      MEDIA_STORAGE_PROVIDER: "memory",
      ROOT_DOMAIN: "localhost",
    });
    expect(report.errors).toHaveLength(2);
  });

  it("downgrades EVERY check to a warning, not just the storage one, once the E2E-harness flag is set — the admin/web Playwright webServer legitimately reuses the seeded dev database and ROOT_DOMAIN", () => {
    const report = findDangerousProductionConfig({
      ...BASE,
      MEDIA_STORAGE_PROVIDER: "memory",
      MEDIA_ALLOW_MEMORY_IN_PRODUCTION: true,
      DATABASE_URL_APP:
        "postgresql://provence360_app:provence360_app@localhost:5432/provence360_dev",
      ROOT_DOMAIN: "localhost",
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings.length).toBeGreaterThanOrEqual(3);
  });
});

describe("dbEnvSchema shape", () => {
  it("requires exactly the four distinct role connection strings — no fewer, no collapsing them", () => {
    const keys = Object.keys(dbEnvSchema.shape);
    expect(keys.sort()).toEqual([
      "DATABASE_URL",
      "DATABASE_URL_APP",
      "DATABASE_URL_AUTH",
      "DATABASE_URL_RESOLVER",
    ]);
  });
});
