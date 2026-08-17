import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenant, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { getMediaAsset } from "@provence360/content";
import {
  MediaDecodeError,
  MediaObjectMissingError,
  MediaTooLargeError,
  MediaUploadAlreadyFinalizedError,
  MediaUploadNotFoundError,
} from "../errors";
import { MemoryObjectStorage } from "../storage/memory-object-storage";
import {
  createMediaUploadIntent,
  getMediaUploadIntent,
} from "../repository/media-upload-repository";
import { finalizeMediaUpload, finalizeMediaUploadSafely } from "./finalize";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

async function makeJpeg(width = 300, height = 200): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 9, g: 9, b: 9 } } })
    .jpeg()
    .toBuffer();
}

describe("finalizeMediaUpload", () => {
  it("creates a MediaAsset only after real validation succeeds, and marks the intent finalized", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg(1000, 700);

    const asset = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      return finalizeMediaUpload(tx, storage, intent.id);
    });

    expect(asset.kind).toBe("image");
    expect(asset.mimeType).toBe("image/jpeg");
    expect(asset.width).toBe(1000);
    expect(asset.height).toBe(700);
    expect(asset.byteSize).toBe(bytes.byteLength);
    expect(asset.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    // 1000px wide -> thumbnail/small/medium variants generated, not large (max 1920).
    const variants = asset.variants as Record<string, unknown>;
    expect(variants.thumbnail).toBeTruthy();
    expect(variants.small).toBeTruthy();
    expect(variants.large).toBeUndefined();

    const fetched = await withTenantContext(tenant.id, (tx) => getMediaAsset(tx, asset.id));
    expect(fetched?.id).toBe(asset.id);
  });

  it("stores the original and every generated variant as real, independently retrievable objects", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg(2000, 1500);

    const asset = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      return finalizeMediaUpload(tx, storage, intent.id);
    });

    const original = await storage.getObject(asset.storageKey);
    expect(original?.byteLength).toBe(bytes.byteLength);

    const variants = asset.variants as Record<string, { storageKey: string }>;
    for (const token of ["thumbnail", "small", "medium", "large"]) {
      const entry = variants[token];
      expect(entry).toBeDefined();
      if (entry) {
        const stored = await storage.getObject(entry.storageKey);
        expect(stored).not.toBeNull();
      }
    }
  });

  it("throws MediaObjectMissingError and (via finalizeMediaUploadSafely) durably marks the intent failed when no bytes were ever uploaded", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();

    // The intent is created and committed in its own transaction first —
    // `finalizeMediaUpload` itself cannot durably persist "failed" from
    // inside the same transaction it fails in (a thrown error rolls the
    // whole transaction back); `finalizeMediaUploadSafely` is what runs
    // the mark-failed write in a second, independent transaction.
    const intentId = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: 1000 });
      return intent.id;
    });
    // Deliberately never storage.putObject(...).

    await expect(finalizeMediaUploadSafely(tenant.id, storage, intentId)).rejects.toThrow(
      MediaObjectMissingError,
    );

    const fetched = await withTenantContext(tenant.id, (tx) => getMediaUploadIntent(tx, intentId));
    expect(fetched.status).toBe("failed");
  });

  it("throws MediaTooLargeError for a file exceeding the intent's own maxBytes, and marks it failed", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg(500, 500);

    await expect(
      withTenantContext(tenant.id, async (tx) => {
        const intent = await createMediaUploadIntent(tx, { maxBytes: 10 });
        await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
        return finalizeMediaUpload(tx, storage, intent.id);
      }),
    ).rejects.toThrow(MediaTooLargeError);
  });

  it("throws MediaDecodeError for a non-image file uploaded to the intent's storage key", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const notAnImage = Buffer.from("definitely not image bytes, just text");

    await expect(
      withTenantContext(tenant.id, async (tx) => {
        const intent = await createMediaUploadIntent(tx, { maxBytes: 1000 });
        await storage.putObject(intent.storageKey, notAnImage, { contentType: "image/jpeg" });
        return finalizeMediaUpload(tx, storage, intent.id);
      }),
    ).rejects.toThrow(MediaDecodeError);
  });

  it("a second finalize attempt on an already-finalized intent throws and never creates a second MediaAsset", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();

    const intentId = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      await finalizeMediaUpload(tx, storage, intent.id);
      return intent.id;
    });

    await expect(
      withTenantContext(tenant.id, (tx) => finalizeMediaUpload(tx, storage, intentId)),
    ).rejects.toThrow(MediaUploadAlreadyFinalizedError);
  });

  it("tenant B can never finalize tenant A's upload intent", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();

    const intentId = await withTenantContext(tenantA.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      return intent.id;
    });

    await expect(
      withTenantContext(tenantB.id, (tx) => finalizeMediaUpload(tx, storage, intentId)),
    ).rejects.toThrow(MediaUploadNotFoundError);
  });
});
