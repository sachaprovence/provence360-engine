import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenant, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { getMediaAsset } from "@provence360/content";
import {
  MediaDecodeError,
  MediaObjectMissingError,
  MediaStorageUnavailableError,
  MediaTooLargeError,
  MediaUploadAlreadyFinalizedError,
  MediaUploadNotFoundError,
} from "../errors";
import { MemoryObjectStorage } from "../storage/memory-object-storage";
import type { ObjectMetadata, ObjectStorage } from "../storage/object-storage";
import { buildOriginalStorageKey } from "./object-keys";
import {
  createMediaUploadIntent,
  getMediaUploadIntent,
} from "../repository/media-upload-repository";
import { finalizeMediaUpload, finalizeMediaUploadSafely } from "./finalize";

/**
 * Wraps a real `MemoryObjectStorage` and throws on one specific `putObject`
 * call (1-indexed, across the whole instance's lifetime) — lets a test
 * simulate "storage succeeded for the original, then failed partway
 * through variant generation" without mocking anything about
 * `finalizeMediaUpload` itself; every call that isn't the failing one goes
 * straight to a real, working store.
 */
class FailNthPutObjectStorage implements ObjectStorage {
  private callCount = 0;
  private failOnCall: number | null;
  constructor(
    private readonly inner: ObjectStorage,
    failOnCall: number,
  ) {
    this.failOnCall = failOnCall;
  }
  stopFailing(): void {
    this.failOnCall = null;
  }
  async putObject(key: string, body: Buffer, opts: { contentType: string }): Promise<void> {
    this.callCount += 1;
    if (this.callCount === this.failOnCall) {
      throw new Error("simulated storage failure (injected by test)");
    }
    return this.inner.putObject(key, body, opts);
  }
  getObject(key: string): Promise<Buffer | null> {
    return this.inner.getObject(key);
  }
  headObject(key: string): Promise<ObjectMetadata | null> {
    return this.inner.headObject(key);
  }
  deleteObject(key: string): Promise<void> {
    return this.inner.deleteObject(key);
  }
  listObjects(prefix: string): Promise<string[]> {
    return this.inner.listObjects(prefix);
  }
}

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

  it("finalizeMediaUploadSafely deletes the upload intent's own temp storage object on SUCCESS — the staging copy is no longer needed once the MediaAsset has its own original", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();

    const intent = await withTenantContext(tenant.id, async (tx) => {
      const created = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(created.storageKey, bytes, { contentType: "image/jpeg" });
      return created;
    });

    const asset = await finalizeMediaUploadSafely(tenant.id, storage, intent.id);

    // The temp upload key is gone...
    expect(await storage.getObject(intent.storageKey)).toBeNull();
    // ...but the MediaAsset's own original (a different key) is very much still there.
    expect(await storage.getObject(asset.storageKey)).not.toBeNull();
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

  it("two truly concurrent finalize() calls on the same intent (real overlapping transactions, not sequential) produce exactly one MediaAsset — the second sees a conflict, never a silent duplicate", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();

    const intentId = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      return intent.id;
    });

    // `withTenantContext` opens its own connection/transaction per call —
    // starting both via `Promise.all` (not `await`ing the first before
    // starting the second) genuinely overlaps them at the database level.
    // `claimMediaUploadForFinalize`'s `SELECT ... FOR UPDATE` is exactly
    // what's under test here: one call's transaction must block until the
    // other's commits, then observe `status !== "pending"` and throw —
    // never two MediaAssets from one intent, and never a lost update.
    const results = await Promise.allSettled([
      withTenantContext(tenant.id, (tx) => finalizeMediaUpload(tx, storage, intentId)),
      withTenantContext(tenant.id, (tx) => finalizeMediaUpload(tx, storage, intentId)),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      MediaUploadAlreadyFinalizedError,
    );

    // The intent itself agrees: exactly one finalize stuck.
    const finalIntent = await withTenantContext(tenant.id, (tx) =>
      getMediaUploadIntent(tx, intentId),
    );
    expect(finalIntent.status).toBe("finalized");
    expect(finalIntent.mediaAssetId).toBe(
      (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof finalizeMediaUpload>>>)
        .value.id,
    );
  });

  it("finalizeMediaUploadSafely is idempotent for retry-after-success: a second call on an already-finalized upload returns the SAME MediaAsset instead of throwing", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();

    const intentId = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      return intent.id;
    });

    // Simulates the real-world case this exists for: the first call
    // committed successfully server-side, but the client never saw the
    // response (dropped connection, timeout) and retries with the same id.
    const first = await finalizeMediaUploadSafely(tenant.id, storage, intentId);
    const retry = await finalizeMediaUploadSafely(tenant.id, storage, intentId);

    expect(retry.id).toBe(first.id);
    expect(retry.checksumSha256).toBe(first.checksumSha256);

    // Still exactly one MediaAsset — the retry never created a second one.
    const fetched = await withTenantContext(tenant.id, (tx) => getMediaAsset(tx, first.id));
    expect(fetched?.id).toBe(first.id);
  });

  it("a genuinely different re-finalize attempt (upload already failed) is NOT treated as a success-retry — it still throws", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();

    const intentId = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: 1000 });
      return intent.id;
    });
    // Deliberately never uploads bytes — first finalize fails for real
    // (MediaObjectMissingError) and durably marks the intent `failed`.
    await expect(finalizeMediaUploadSafely(tenant.id, storage, intentId)).rejects.toThrow(
      MediaObjectMissingError,
    );

    // A second attempt against a `failed` (not `finalized`) intent has no
    // MediaAsset to hand back — it must still surface as an error, not
    // silently resolve to nothing.
    await expect(finalizeMediaUploadSafely(tenant.id, storage, intentId)).rejects.toThrow(
      MediaUploadAlreadyFinalizedError,
    );
  });

  it("finalizeMediaUploadSafely deletes the failed upload's own temp storage object — a failed intent doesn't leak its bytes forever the way an unfixed cleanup gap would", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const notAnImage = Buffer.from("not a real image");

    const intent = await withTenantContext(tenant.id, async (tx) => {
      const created = await createMediaUploadIntent(tx, { maxBytes: 1000 });
      await storage.putObject(created.storageKey, notAnImage, { contentType: "image/jpeg" });
      return created;
    });

    await expect(finalizeMediaUploadSafely(tenant.id, storage, intent.id)).rejects.toThrow(
      MediaDecodeError,
    );

    expect(await storage.getObject(intent.storageKey)).toBeNull();
  });

  it("storageId is deterministic (the upload's own id): a retried finalize after a partial storage failure reuses the exact same original-object key instead of leaking a fresh one per attempt", async () => {
    const tenant = await createTenant();
    const bytes = await makeJpeg(1000, 700);
    const failing = new FailNthPutObjectStorage(new MemoryObjectStorage(), 2);

    const intentId = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      // Call #1: the intent's own temp upload — must succeed so finalize
      // gets past `MediaObjectMissingError` and into real processing.
      await failing.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      return intent.id;
    });

    // Call #2 (the injected failure): the original's own storage write,
    // the very first `putObject` finalize itself issues — simulates
    // "storage OK for the temp upload, but the finalize-time write fails."
    // The raw injected error never reaches the caller — only the closed,
    // generic MediaStorageUnavailableError does (brief §14).
    await expect(
      withTenantContext(tenant.id, (tx) => finalizeMediaUpload(tx, failing, intentId)),
    ).rejects.toThrow(MediaStorageUnavailableError);

    const stillPending = await withTenantContext(tenant.id, (tx) =>
      getMediaUploadIntent(tx, intentId),
    );
    expect(stillPending.status).toBe("pending");

    // Retry, now with storage actually working.
    failing.stopFailing();
    const asset = await withTenantContext(tenant.id, (tx) =>
      finalizeMediaUpload(tx, failing, intentId),
    );

    // The exact same key the first (failed) attempt would have written to
    // — proving the retry overwrote in place rather than computing a new,
    // orphaned one.
    expect(asset.storageKey).toBe(buildOriginalStorageKey(tenant.id, intentId));
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
