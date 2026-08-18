import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
