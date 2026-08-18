import { describe, expect, it } from "vitest";
import {
  dbEnvSchema,
  findDangerousProductionConfig,
  loadAdminEnv,
  loadDbEnv,
  loadEnv,
  loadMediaEnv,
  loadWebEnv,
  loadWorkerEnv,
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

// v1.0.1 — brief SUJET B root cause: through v1.0, S3_FORCE_PATH_STYLE
// always defaulted to `false`, which produces AWS SDK virtual-hosted-style
// addressing (`<bucket>.<host>`) against ANY custom `S3_ENDPOINT` that
// isn't a bare IP literal — a hostname no self-hosted S3-compatible server
// (s3rver, MinIO, ...) has real DNS for. See
// packages/media/src/storage/config.test.ts's "smoke-test regression"
// suite for a real, non-mocked reproduction of the resulting failure
// against a real s3rver, and this final report's STORAGE SMOKE ROOT CAUSE
// section for the full mechanism.
describe("mediaEnvSchema — S3_FORCE_PATH_STYLE contextual default", () => {
  const S3_BASE = {
    MEDIA_STORAGE_PROVIDER: "s3" as const,
    S3_REGION: "us-east-1",
    S3_BUCKET: "some-bucket",
    S3_ACCESS_KEY_ID: "AKIA...",
    S3_SECRET_ACCESS_KEY: "secret",
  };

  it("defaults to true when a custom S3_ENDPOINT is set and the operator leaves it unset — the safe choice for any non-AWS provider", () => {
    const env = mediaEnvSchema.parse({ ...S3_BASE, S3_ENDPOINT: "https://minio.internal:9000" });
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it("defaults to false when no S3_ENDPOINT is set — real AWS S3, where virtual-hosted-style is correct", () => {
    const env = mediaEnvSchema.parse(S3_BASE);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it("an explicit S3_FORCE_PATH_STYLE=false always wins, even with a custom endpoint", () => {
    const env = mediaEnvSchema.parse({
      ...S3_BASE,
      S3_ENDPOINT: "https://minio.internal:9000",
      S3_FORCE_PATH_STYLE: "false",
    });
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it("an explicit S3_FORCE_PATH_STYLE=true always wins, even without a custom endpoint", () => {
    const env = mediaEnvSchema.parse({ ...S3_BASE, S3_FORCE_PATH_STYLE: "true" });
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
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

// v1.0.1 — brief SUJET D: per-process schemas built from a real audit of
// each app's actual imports (see env.ts's webEnvSchema/adminEnvSchema/
// workerEnvSchema doc comments for the exact trace). Each suite below
// covers the four required cases: a minimal valid config succeeds; a
// genuinely required variable's absence fails; an other-process-only
// variable's absence still succeeds; and the dangerous-production-config
// case is tested with that process's own real env shape.
const RESOLVER_URL = "postgresql://resolver_role:resolver_pass@db-host:5432/prod";
const APP_URL = "postgresql://app_role:app_pass@db-host:5432/prod";
const AUTH_URL = "postgresql://auth_role:auth_pass@db-host:5432/prod";
const ROOT_DOMAIN = "provence360.app";

describe("loadWebEnv — apps/web's real environment needs", () => {
  const MINIMAL_WEB_ENV = {
    NODE_ENV: "development",
    ROOT_DOMAIN,
    DATABASE_URL_RESOLVER: RESOLVER_URL,
    DATABASE_URL_APP: APP_URL,
  };

  it("a minimal valid web configuration succeeds", () => {
    expect(() => loadWebEnv(MINIMAL_WEB_ENV)).not.toThrow();
    const env = loadWebEnv(MINIMAL_WEB_ENV);
    expect(env.DATABASE_URL_RESOLVER).toBe(RESOLVER_URL);
    expect(env.DATABASE_URL_APP).toBe(APP_URL);
  });

  it("fails when a genuinely required variable is absent (DATABASE_URL_APP — withTenantContext needs it to render published content)", () => {
    const { DATABASE_URL_APP: _drop, ...withoutApp } = MINIMAL_WEB_ENV;
    expect(() => loadWebEnv(withoutApp)).toThrow(/DATABASE_URL_APP/);
  });

  it("fails when the resolver role is absent (resolveSiteByHostname needs it)", () => {
    const { DATABASE_URL_RESOLVER: _drop, ...withoutResolver } = MINIMAL_WEB_ENV;
    expect(() => loadWebEnv(withoutResolver)).toThrow(/DATABASE_URL_RESOLVER/);
  });

  it("succeeds without DATABASE_URL_AUTH — web has no login, it never touches the auth role", () => {
    expect(() => loadWebEnv({ ...MINIMAL_WEB_ENV })).not.toThrow();
    expect("DATABASE_URL_AUTH" in loadWebEnv(MINIMAL_WEB_ENV)).toBe(false);
  });

  it("succeeds without the bare schema-owning DATABASE_URL — web never migrates/seeds", () => {
    expect(() => loadWebEnv(MINIMAL_WEB_ENV)).not.toThrow();
    expect("DATABASE_URL" in loadWebEnv(MINIMAL_WEB_ENV)).toBe(false);
  });

  it("dangerous-production-config: web's real env shape still catches dev DB creds and ROOT_DOMAIN=localhost", () => {
    const dangerous = findDangerousProductionConfig({
      ...MINIMAL_WEB_ENV,
      NODE_ENV: "production" as const,
      DATABASE_URL_APP: "postgresql://provence360_app:provence360_app@prod-host:5432/x",
      ROOT_DOMAIN: "localhost",
    });
    expect(dangerous.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("loadAdminEnv — apps/admin's real environment needs", () => {
  const MINIMAL_ADMIN_ENV = {
    NODE_ENV: "development",
    ROOT_DOMAIN,
    DATABASE_URL_RESOLVER: RESOLVER_URL,
    DATABASE_URL_APP: APP_URL,
    DATABASE_URL_AUTH: AUTH_URL,
  };

  it("a minimal valid admin configuration succeeds", () => {
    expect(() => loadAdminEnv(MINIMAL_ADMIN_ENV)).not.toThrow();
  });

  it("fails when a genuinely required variable is absent (DATABASE_URL_AUTH — login/session/membership lookups need it)", () => {
    const { DATABASE_URL_AUTH: _drop, ...withoutAuth } = MINIMAL_ADMIN_ENV;
    expect(() => loadAdminEnv(withoutAuth)).toThrow(/DATABASE_URL_AUTH/);
  });

  it("fails when the app role is absent (withAuthorizedTenantContext needs it for every tenant-scoped action)", () => {
    const { DATABASE_URL_APP: _drop, ...withoutApp } = MINIMAL_ADMIN_ENV;
    expect(() => loadAdminEnv(withoutApp)).toThrow(/DATABASE_URL_APP/);
  });

  it("succeeds without the bare schema-owning DATABASE_URL — admin never migrates", () => {
    expect(() => loadAdminEnv(MINIMAL_ADMIN_ENV)).not.toThrow();
    expect("DATABASE_URL" in loadAdminEnv(MINIMAL_ADMIN_ENV)).toBe(false);
  });

  it("dangerous-production-config: admin's real env shape still catches dev DB creds on the auth role specifically", () => {
    const dangerous = findDangerousProductionConfig({
      ...MINIMAL_ADMIN_ENV,
      NODE_ENV: "production" as const,
      DATABASE_URL_AUTH: "postgresql://provence360_auth:provence360_auth@prod-host:5432/x",
    });
    expect(dangerous.errors).toEqual([
      expect.stringMatching(/development\/CI default credentials/),
    ]);
  });
});

describe("loadWorkerEnv — apps/worker's real environment needs (v0.1 placeholder: no DB access yet)", () => {
  it("a minimal valid worker configuration succeeds with only NODE_ENV", () => {
    expect(() => loadWorkerEnv({ NODE_ENV: "development" })).not.toThrow();
  });

  it("succeeds with NODE_ENV unset too (defaults to development)", () => {
    expect(() => loadWorkerEnv({})).not.toThrow();
  });

  it("fails only when NODE_ENV itself is malformed — the one thing the worker's real schema validates", () => {
    expect(() => loadWorkerEnv({ NODE_ENV: "not-a-real-environment" })).toThrow();
  });

  it("succeeds without any DATABASE_URL* variable — the worker doesn't consume the DB at all today", () => {
    const env = loadWorkerEnv({ NODE_ENV: "development" });
    expect("DATABASE_URL" in env).toBe(false);
    expect("DATABASE_URL_APP" in env).toBe(false);
    expect("DATABASE_URL_RESOLVER" in env).toBe(false);
    expect("DATABASE_URL_AUTH" in env).toBe(false);
  });

  it("succeeds without ROOT_DOMAIN or any media variable — the worker never resolves a hostname or touches storage", () => {
    const env = loadWorkerEnv({ NODE_ENV: "development" });
    expect("ROOT_DOMAIN" in env).toBe(false);
    expect("MEDIA_STORAGE_PROVIDER" in env).toBe(false);
  });

  it("dangerous-production-config: the worker's real (minimal) env shape has nothing DB/media/domain-related to flag — not a weakened protection, since it never consumed any of those values", () => {
    const dangerous = findDangerousProductionConfig({
      ...loadWorkerEnv({ NODE_ENV: "production" }),
    });
    expect(dangerous).toEqual({ errors: [], warnings: [] });
  });
});
