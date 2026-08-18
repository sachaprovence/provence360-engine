import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@provence360/observability";
import { MediaStorageUnavailableError } from "./errors";
import { createTenant, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { MemoryObjectStorage } from "./storage/memory-object-storage";
import type { ObjectMetadata, ObjectStorage } from "./storage/object-storage";
import { createMediaUploadIntent } from "./repository/media-upload-repository";
import { finalizeMediaUpload, finalizeMediaUploadSafely } from "./upload/finalize";
import { resolveMediaDelivery } from "./delivery/media-delivery-handler";

/**
 * Brief §13 asks for a specific, named set of structured events. This
 * doesn't re-test every behavior those code paths already have their own
 * tests for — it exists purely to prove the *events themselves* actually
 * fire under the exact scenario each name implies, so "this event exists
 * in the codebase" and "this event fires when it's supposed to" are both
 * verified, not just assumed from reading the source.
 */

class AlwaysFailingStorage implements ObjectStorage {
  async putObject(): Promise<void> {
    throw new Error("simulated storage outage");
  }
  async getObject(): Promise<Buffer | null> {
    throw new Error("simulated storage outage");
  }
  async headObject(): Promise<ObjectMetadata | null> {
    throw new Error("simulated storage outage");
  }
  async deleteObject(): Promise<void> {
    throw new Error("simulated storage outage");
  }
  async listObjects(): Promise<string[]> {
    throw new Error("simulated storage outage");
  }
}

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function makeJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 300, height: 200, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .jpeg()
    .toBuffer();
}

describe("media.* observability events", () => {
  it("media.upload.intent_created fires when an upload intent is created", async () => {
    const infoSpy = vi.spyOn(logger, "info");
    const tenant = await createTenant();
    await withTenantContext(tenant.id, (tx) => createMediaUploadIntent(tx, { maxBytes: 1000 }));

    expect(infoSpy).toHaveBeenCalledWith(
      "media.upload.intent_created",
      expect.objectContaining({ tenantId: tenant.id }),
    );
  });

  it("media.storage.get_failed fires when reading the uploaded bytes back from storage throws", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const tenant = await createTenant();
    const storage = new AlwaysFailingStorage();

    const intentId = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: 1000 });
      return intent.id;
    });

    await expect(
      withTenantContext(tenant.id, (tx) => finalizeMediaUpload(tx, storage, intentId)),
    ).rejects.toThrow(MediaStorageUnavailableError);

    expect(warnSpy).toHaveBeenCalledWith(
      "media.storage.get_failed",
      expect.objectContaining({ tenantId: tenant.id, uploadId: intentId }),
    );
  });

  it("media.storage.put_failed fires when writing the original object to storage throws", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const tenant = await createTenant();
    const bytes = await makeJpeg();

    // Reads succeed (so finalize gets past the temp-object read and into
    // validation/processing); every write fails, simulating a storage
    // backend that's reachable for reads but rejecting writes (e.g. a
    // read-replica misconfiguration, a full bucket, a permissions error).
    const working = new MemoryObjectStorage();
    const readOnly: ObjectStorage = {
      putObject: () => {
        throw new Error("simulated write failure");
      },
      getObject: (key) => working.getObject(key),
      headObject: (key) => working.headObject(key),
      deleteObject: (key) => working.deleteObject(key),
      listObjects: (prefix) => working.listObjects(prefix),
    };

    const intent = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 }),
    );
    await working.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });

    await expect(
      withTenantContext(tenant.id, (tx) => finalizeMediaUpload(tx, readOnly, intent.id)),
    ).rejects.toThrow(MediaStorageUnavailableError);

    expect(warnSpy).toHaveBeenCalledWith(
      "media.storage.put_failed",
      expect.objectContaining({ tenantId: tenant.id, uploadId: intent.id }),
    );
  });

  it("media.delivery.not_found fires with reason 'storage_object_missing' when a MediaAsset's row exists but its bytes don't", async () => {
    const infoSpy = vi.spyOn(logger, "info");
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();

    const asset = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      return finalizeMediaUpload(tx, storage, intent.id);
    });
    await storage.deleteObject(asset.storageKey);

    const result = await withTenantContext(tenant.id, (tx) =>
      resolveMediaDelivery(tx, storage, asset.id, asset.checksumSha256 ?? "", "original"),
    );
    expect(result).toBeNull();

    expect(infoSpy).toHaveBeenCalledWith(
      "media.delivery.not_found",
      expect.objectContaining({
        tenantId: tenant.id,
        assetId: asset.id,
        reason: "storage_object_missing",
      }),
    );
  });

  it("media.upload.finalize_retry_after_success fires on a genuine retry-after-success", async () => {
    const infoSpy = vi.spyOn(logger, "info");
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();

    const intent = await withTenantContext(tenant.id, async (tx) => {
      const created = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(created.storageKey, bytes, { contentType: "image/jpeg" });
      return created;
    });

    await finalizeMediaUploadSafely(tenant.id, storage, intent.id);
    await finalizeMediaUploadSafely(tenant.id, storage, intent.id);

    expect(infoSpy).toHaveBeenCalledWith(
      "media.upload.finalize_retry_after_success",
      expect.objectContaining({ tenantId: tenant.id, uploadId: intent.id }),
    );
  });
});
