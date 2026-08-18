import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryObjectStorage } from "./memory-object-storage";
import { S3ObjectStorage } from "./s3-object-storage";
import { getObjectStorage, resetObjectStorageForTests } from "./config";

const ENV_KEYS = [
  "NODE_ENV",
  "MEDIA_STORAGE_PROVIDER",
  "MEDIA_ALLOW_MEMORY_IN_PRODUCTION",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_ENDPOINT",
  "S3_FORCE_PATH_STYLE",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  resetObjectStorageForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  resetObjectStorageForTests();
});

describe("getObjectStorage", () => {
  it("defaults to MemoryObjectStorage outside production, and memoizes the same instance across calls", () => {
    process.env.NODE_ENV = "test";
    delete process.env.MEDIA_STORAGE_PROVIDER;

    const first = getObjectStorage();
    const second = getObjectStorage();
    expect(first).toBeInstanceOf(MemoryObjectStorage);
    expect(second).toBe(first);
  });

  it("refuses to start with NODE_ENV=production and the default (memory) provider — a loud error, never a silent, data-losing fallback", () => {
    process.env.NODE_ENV = "production";
    delete process.env.MEDIA_STORAGE_PROVIDER;

    expect(() => getObjectStorage()).toThrow(/MEDIA_STORAGE_PROVIDER=memory/);
    expect(() => getObjectStorage()).toThrow(/NODE_ENV=production/);
  });

  it("refuses to start with NODE_ENV=production and an EXPLICIT MEDIA_STORAGE_PROVIDER=memory too — not just the unset default", () => {
    process.env.NODE_ENV = "production";
    process.env.MEDIA_STORAGE_PROVIDER = "memory";

    expect(() => getObjectStorage()).toThrow(/MEDIA_STORAGE_PROVIDER=memory/);
  });

  it("NODE_ENV=production with MEDIA_STORAGE_PROVIDER=s3 and valid credentials constructs a real S3ObjectStorage — never throws", () => {
    process.env.NODE_ENV = "production";
    process.env.MEDIA_STORAGE_PROVIDER = "s3";
    process.env.S3_REGION = "us-east-1";
    process.env.S3_BUCKET = "prod-bucket";
    process.env.S3_ACCESS_KEY_ID = "AKIAFAKE";
    process.env.S3_SECRET_ACCESS_KEY = "fake-secret";

    expect(getObjectStorage()).toBeInstanceOf(S3ObjectStorage);
  });

  it("MEDIA_ALLOW_MEMORY_IN_PRODUCTION=true is a deliberate, explicit escape hatch (used only by the E2E webServer configs) — no throw", () => {
    process.env.NODE_ENV = "production";
    delete process.env.MEDIA_STORAGE_PROVIDER;
    process.env.MEDIA_ALLOW_MEMORY_IN_PRODUCTION = "true";

    expect(() => getObjectStorage()).not.toThrow();
    expect(getObjectStorage()).toBeInstanceOf(MemoryObjectStorage);
  });

  it("MEDIA_STORAGE_PROVIDER=memory outside production (dev/test) is fine, no throw", () => {
    process.env.NODE_ENV = "development";
    process.env.MEDIA_STORAGE_PROVIDER = "memory";
    expect(() => getObjectStorage()).not.toThrow();
  });

  it("resetObjectStorageForTests clears the memoized instance — the next call constructs a fresh one", () => {
    process.env.NODE_ENV = "test";
    const first = getObjectStorage();
    resetObjectStorageForTests();
    const second = getObjectStorage();
    expect(second).not.toBe(first);
  });
});

// v1.0.1 — brief SUJET B, the regression test for the smoke-test hang.
// v0.9.1's own s3-object-storage.integration.test.ts always passes
// `forcePathStyle: true` explicitly and would never have caught this: it
// never exercises `loadMediaEnv`/`createObjectStorageFromEnv` at all. This
// suite instead drives the exact path a real deployment (and
// `smoke-storage.ts`) takes — environment variables in, `getObjectStorage()`
// out — against a real, separately-running S3-compatible HTTP server, with
// the one env var an operator following prior docs would most plausibly
// forget: S3_FORCE_PATH_STYLE. A real put/get round-trip succeeding here,
// with that variable deliberately left unset, is the actual proof the fix
// works — not an assertion about `forcePathStyle`'s parsed value alone.
describe("getObjectStorage — real S3-compatible smoke-test regression (SUJET B)", () => {
  const port = 34599 + 1;
  const bucket = "provence360-smoke-regression";
  let server: S3rver;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "s3rver-smoke-regression-"));
    server = new S3rver({
      port,
      address: "127.0.0.1",
      silent: true,
      directory: dataDir,
      configureBuckets: [{ name: bucket, configs: [] }],
    });
    await server.run();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("a real put/get round-trips against a non-AWS endpoint with S3_FORCE_PATH_STYLE left UNSET — the exact configuration that used to hang on a bare virtual-hosted-style DNS lookup", async () => {
    process.env.NODE_ENV = "development";
    process.env.MEDIA_STORAGE_PROVIDER = "s3";
    process.env.S3_REGION = "us-east-1";
    process.env.S3_BUCKET = bucket;
    process.env.S3_ACCESS_KEY_ID = "S3RVER";
    process.env.S3_SECRET_ACCESS_KEY = "S3RVER";
    process.env.S3_ENDPOINT = `http://localhost:${port}`;
    delete process.env.S3_FORCE_PATH_STYLE;

    const storage = getObjectStorage();
    expect(storage).toBeInstanceOf(S3ObjectStorage);

    const key = `__smoke_test__/regression-${Date.now()}`;
    const body = Buffer.from("SUJET B regression — real bytes, real HTTP, no mock", "utf8");

    await storage.putObject(key, body, { contentType: "text/plain" });
    const fetched = await storage.getObject(key);
    expect(fetched?.equals(body)).toBe(true);

    await storage.deleteObject(key);
    expect(await storage.getObject(key)).toBeNull();
  });
});
