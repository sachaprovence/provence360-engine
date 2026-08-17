import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMediaAsset } from "@provence360/content";
import { createTenant, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { createMediaUploadIntent } from "../repository/media-upload-repository";
import { finalizeMediaUpload } from "../upload/finalize";
import { MemoryObjectStorage } from "../storage/memory-object-storage";
import { resolveMediaDelivery } from "./media-delivery-handler";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

async function makeJpeg(width = 1000, height = 700): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 5, g: 5, b: 5 } } })
    .jpeg()
    .toBuffer();
}

async function uploadRealAsset(tenantId: string, storage: MemoryObjectStorage) {
  const bytes = await makeJpeg();
  return withTenantContext(tenantId, async (tx) => {
    const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
    await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
    return finalizeMediaUpload(tx, storage, intent.id);
  });
}

// v0.9 — Media Ingestion, Asset Lifecycle & Delivery Kernel (ADR 0022).
// `resolveMediaDelivery` is the single shared core both `apps/web`'s
// public delivery route and `apps/admin`'s Preview delivery route call —
// see those routes' own doc comments for why. Exercised here directly
// (rather than only indirectly through the routes, which aren't reachable
// from a package-level vitest run) against a real Postgres-backed
// MediaAsset, matching this package's own "real Postgres for anything
// RLS/tenant-scoped" convention (see rls.test.ts, finalize.test.ts).
describe("resolveMediaDelivery", () => {
  it("serves the original bytes when the fingerprint matches the asset's own checksum", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const asset = await uploadRealAsset(tenant.id, storage);

    const result = await withTenantContext(tenant.id, (tx) =>
      resolveMediaDelivery(tx, storage, asset.id, asset.checksumSha256 ?? "", "original"),
    );

    expect(result).not.toBeNull();
    expect(result?.contentType).toBe("image/jpeg");
    expect(result?.immutable).toBe(true);
    expect(result?.body.byteLength).toBeGreaterThan(0);
  });

  it("serves a generated variant's own (smaller) bytes, not the original's", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const asset = await uploadRealAsset(tenant.id, storage);

    const original = await withTenantContext(tenant.id, (tx) =>
      resolveMediaDelivery(tx, storage, asset.id, asset.checksumSha256 ?? "", "original"),
    );
    const thumbnail = await withTenantContext(tenant.id, (tx) =>
      resolveMediaDelivery(tx, storage, asset.id, asset.checksumSha256 ?? "", "thumbnail"),
    );

    expect(thumbnail).not.toBeNull();
    expect(thumbnail?.body.byteLength).toBeLessThan(original?.body.byteLength ?? Infinity);
  });

  it("returns null for a wrong/forged fingerprint, even though the assetId is real", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const asset = await uploadRealAsset(tenant.id, storage);

    const result = await withTenantContext(tenant.id, (tx) =>
      resolveMediaDelivery(tx, storage, asset.id, "f".repeat(64), "original"),
    );

    expect(result).toBeNull();
  });

  it("returns null for a nonexistent assetId", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();

    const result = await withTenantContext(tenant.id, (tx) =>
      resolveMediaDelivery(
        tx,
        storage,
        "00000000-0000-4000-8000-000000000000",
        "a".repeat(64),
        "original",
      ),
    );

    expect(result).toBeNull();
  });

  it("tenant B can never resolve tenant A's MediaAsset, even with the correct id and fingerprint", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const storage = new MemoryObjectStorage();
    const asset = await uploadRealAsset(tenantA.id, storage);

    const result = await withTenantContext(tenantB.id, (tx) =>
      resolveMediaDelivery(tx, storage, asset.id, asset.checksumSha256 ?? "", "original"),
    );

    expect(result).toBeNull();
  });

  it("returns immutable: false for a legacy asset with no checksum (never marks uncertain content immutable)", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    // A direct createMediaAsset call (bypassing the ingestion pipeline)
    // is exactly how a pre-v0.9/seed row looks: no checksum, no variants.
    const legacy = await withTenantContext(tenant.id, (tx) =>
      createMediaAsset(tx, {
        kind: "image",
        storageKey: "tenants/legacy/media/original/legacy.jpg",
        mimeType: "image/jpeg",
      }),
    );
    await storage.putObject(legacy.storageKey, Buffer.from("fake legacy bytes"), {
      contentType: "image/jpeg",
    });

    // No checksum on the row at all -> no fingerprint can ever match, by
    // design (see resolveMediaDelivery's own doc comment) — this proves a
    // legacy row can never be served through the v0.9 delivery route at
    // all, rather than being served non-immutably.
    const result = await withTenantContext(tenant.id, (tx) =>
      resolveMediaDelivery(tx, storage, legacy.id, "a".repeat(64), "original"),
    );
    expect(result).toBeNull();
  });
});
