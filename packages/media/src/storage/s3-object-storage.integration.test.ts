import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3ObjectStorage } from "./s3-object-storage";

/**
 * A REAL S3-compatible integration suite (brief §4 — one of v0.9.1's
 * absolute top priorities): v0.9 shipped `S3ObjectStorage` with zero
 * coverage against a real S3-compatible endpoint (see its own doc
 * comment, and `MemoryObjectStorage`'s) — a disclosed gap, not silently
 * ignored, but a gap all the same. This suite closes it by exercising the
 * actual production `S3ObjectStorage` class, over real HTTP, against a
 * real S3-REST-API server — never a mock of the AWS SDK, never a second,
 * hand-rolled "S3-like" implementation.
 *
 * MinIO (Docker) was the brief's stated preference, and was tried first —
 * `dockerd` runs fine in this sandbox, but pulling any image is blocked by
 * this environment's own egress policy (`production.cloudfront.docker.com`
 * → 403 at the proxy layer; confirmed via `/__agentproxy/status`, not
 * something to route around per the proxy's own operating rules). `s3rver`
 * is the fallback actually used here: a real, maintained Node.js server
 * that implements the S3 REST API (bucket/object CRUD, real HTTP
 * responses, real error shapes) — installed from the allowlisted npm
 * registry, no Docker or external network required. It is a real S3-
 * compatible *server* being tested against, not a mock of the client SDK:
 * `S3ObjectStorage` talks to it exactly as it would talk to MinIO or AWS,
 * over the real `@aws-sdk/client-s3` wire protocol. See the final report's
 * LIMITATIONS section for exactly what this does and doesn't prove versus
 * a real MinIO/AWS S3/R2 endpoint.
 */
describe("S3ObjectStorage — real S3-compatible integration (s3rver)", () => {
  const port = 34599;
  const bucket = "provence360-integration-test";
  let server: S3rver;
  let dataDir: string;
  let storage: S3ObjectStorage;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "s3rver-"));
    server = new S3rver({
      port,
      address: "127.0.0.1",
      silent: true,
      directory: dataDir,
      configureBuckets: [{ name: bucket, configs: [] }],
    });
    await server.run();

    storage = new S3ObjectStorage({
      bucket,
      region: "us-east-1",
      endpoint: `http://127.0.0.1:${port}`,
      accessKeyId: "S3RVER",
      secretAccessKey: "S3RVER",
      forcePathStyle: true,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("putObject then getObject round-trips the exact bytes", async () => {
    const key = "tenants/t1/media/roundtrip/original";
    const body = Buffer.from("real bytes over real HTTP, not a mock", "utf8");
    await storage.putObject(key, body, { contentType: "text/plain" });

    const result = await storage.getObject(key);
    expect(result).not.toBeNull();
    expect(result?.equals(body)).toBe(true);
  });

  it("getObject on a key that was never written returns null, not a thrown error", async () => {
    const result = await storage.getObject("tenants/t1/media/does-not-exist/original");
    expect(result).toBeNull();
  });

  it("headObject reports real byteSize and contentType without transferring the body", async () => {
    const key = "tenants/t1/media/head-test/original";
    const body = Buffer.alloc(12_345, 7);
    await storage.putObject(key, body, { contentType: "image/png" });

    const meta = await storage.headObject(key);
    expect(meta).toEqual({ byteSize: 12_345, contentType: "image/png" });
  });

  it("headObject on a missing key returns null, not a thrown error", async () => {
    const meta = await storage.headObject("tenants/t1/media/head-missing/original");
    expect(meta).toBeNull();
  });

  it("deleteObject removes the object — a subsequent getObject/headObject see nothing", async () => {
    const key = "tenants/t1/media/delete-test/original";
    await storage.putObject(key, Buffer.from("gone soon"), { contentType: "text/plain" });
    expect(await storage.getObject(key)).not.toBeNull();

    await storage.deleteObject(key);

    expect(await storage.getObject(key)).toBeNull();
    expect(await storage.headObject(key)).toBeNull();
  });

  it("deleteObject on a key that was never written is a no-op, not a thrown error", async () => {
    await expect(
      storage.deleteObject("tenants/t1/media/never-existed/original"),
    ).resolves.toBeUndefined();
  });

  it("putObject overwrites an existing key in place — same key, new bytes, old bytes gone", async () => {
    const key = "tenants/t1/media/overwrite-test/original";
    await storage.putObject(key, Buffer.from("version one"), { contentType: "text/plain" });
    await storage.putObject(key, Buffer.from("version two, replacing the first"), {
      contentType: "text/plain",
    });

    const result = await storage.getObject(key);
    expect(result?.toString("utf8")).toBe("version two, replacing the first");
  });

  it("preserves an opaque key containing multiple path segments and a uuid, unmodified", async () => {
    const key =
      "tenants/11111111-1111-4111-8111-111111111111/media/22222222-2222-4222-8222-222222222222/thumbnail";
    await storage.putObject(key, Buffer.from("variant bytes"), { contentType: "image/webp" });

    const result = await storage.getObject(key);
    expect(result?.toString("utf8")).toBe("variant bytes");
  });

  it("two keys that only differ by tenant path segment never collide (logical tenant isolation at the storage layer)", async () => {
    const keyA = "tenants/tenant-a/media/same-asset-id/original";
    const keyB = "tenants/tenant-b/media/same-asset-id/original";
    await storage.putObject(keyA, Buffer.from("tenant A's bytes"), { contentType: "text/plain" });
    await storage.putObject(keyB, Buffer.from("tenant B's bytes"), { contentType: "text/plain" });

    expect((await storage.getObject(keyA))?.toString("utf8")).toBe("tenant A's bytes");
    expect((await storage.getObject(keyB))?.toString("utf8")).toBe("tenant B's bytes");
  });

  it("round-trips a real binary (non-UTF8-safe) payload without corruption", async () => {
    const key = "tenants/t1/media/binary-test/original";
    const body = Buffer.from([
      0x00, 0xff, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02,
    ]);
    await storage.putObject(key, body, { contentType: "image/png" });

    const result = await storage.getObject(key);
    expect(result?.equals(body)).toBe(true);
  });

  it("round-trips an empty (zero-byte) object", async () => {
    const key = "tenants/t1/media/empty-test/original";
    await storage.putObject(key, Buffer.alloc(0), { contentType: "text/plain" });

    const meta = await storage.headObject(key);
    expect(meta?.byteSize).toBe(0);
    const body = await storage.getObject(key);
    expect(body?.byteLength).toBe(0);
  });

  it("listObjects returns real keys under a prefix, scoped correctly, over a real ListObjectsV2 call", async () => {
    const tenantPrefix = "tenants/list-test-tenant/media/";
    await storage.putObject(`${tenantPrefix}asset-1/original`, Buffer.from("a"), {
      contentType: "text/plain",
    });
    await storage.putObject(`${tenantPrefix}asset-2/original`, Buffer.from("b"), {
      contentType: "text/plain",
    });
    await storage.putObject("tenants/other-tenant/media/asset-3/original", Buffer.from("c"), {
      contentType: "text/plain",
    });

    const keys = await storage.listObjects(tenantPrefix);
    expect(keys.sort()).toEqual([
      `${tenantPrefix}asset-1/original`,
      `${tenantPrefix}asset-2/original`,
    ]);
  });

  it("listObjects on a prefix with nothing under it returns an empty array, not an error", async () => {
    const keys = await storage.listObjects("tenants/nothing-under-this-prefix/");
    expect(keys).toEqual([]);
  });
});
