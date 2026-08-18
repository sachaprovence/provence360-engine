import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenant, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { MemoryObjectStorage } from "../storage/memory-object-storage";
import { createMediaUploadIntent } from "../repository/media-upload-repository";
import { finalizeMediaUpload } from "../upload/finalize";
import { findDbOrphans, findStorageOrphans } from "./orphan-scan";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

async function makeJpeg(width = 300, height = 200): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .toBuffer();
}

describe("findStorageOrphans", () => {
  it("reports nothing for a tenant whose storage exactly matches its DB rows (the common, healthy case)", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();

    await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      await finalizeMediaUpload(tx, storage, intent.id);
    });

    const orphans = await withTenantContext(tenant.id, (tx) => findStorageOrphans(tx, storage));
    expect(orphans).toEqual([]);
  });

  it("a still-pending (never finalized) upload's temp object is NOT reported as an orphan — its row explains it", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();

    await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
    });

    const orphans = await withTenantContext(tenant.id, (tx) => findStorageOrphans(tx, storage));
    expect(orphans).toEqual([]);
  });

  it("an object with no explaining row at all IS reported — e.g. a leftover from a bug, a manual upload, or a pre-fix leaked object", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const mysteryKey = `tenants/${tenant.id}/media/some-mystery-id/original`;
    await storage.putObject(mysteryKey, Buffer.from("nobody knows about this"), {
      contentType: "application/octet-stream",
    });

    const orphans = await withTenantContext(tenant.id, (tx) => findStorageOrphans(tx, storage));
    expect(orphans).toEqual([{ storageKey: mysteryKey }]);
  });

  it("never crosses tenant boundaries — tenant B's objects never appear in tenant A's orphan report, and vice versa", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const storage = new MemoryObjectStorage();
    await storage.putObject(`tenants/${tenantB.id}/media/orphan/original`, Buffer.from("b"), {
      contentType: "text/plain",
    });

    const orphansA = await withTenantContext(tenantA.id, (tx) => findStorageOrphans(tx, storage));
    expect(orphansA).toEqual([]);

    const orphansB = await withTenantContext(tenantB.id, (tx) => findStorageOrphans(tx, storage));
    expect(orphansB).toHaveLength(1);
  });

  it("published-revision-referenced or not, EVERY existing MediaAsset row's storage keys count as referenced — findStorageOrphans never flags a live asset's own bytes just because it's unused in the current draft", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg(2000, 1500); // wide enough to generate every variant

    const asset = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      return finalizeMediaUpload(tx, storage, intent.id);
    });
    expect(asset.storageKey).toBeTruthy();

    const orphans = await withTenantContext(tenant.id, (tx) => findStorageOrphans(tx, storage));
    expect(orphans).toEqual([]);
  });
});

describe("findDbOrphans", () => {
  it("reports nothing when every MediaAsset's storage objects are actually present", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();

    await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      await finalizeMediaUpload(tx, storage, intent.id);
    });

    const orphans = await withTenantContext(tenant.id, (tx) => findDbOrphans(tx, storage));
    expect(orphans).toEqual([]);
  });

  it("reports a MediaAsset whose original object was deleted out-of-band from storage (a DB row now promising bytes that don't exist)", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();

    const asset = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      return finalizeMediaUpload(tx, storage, intent.id);
    });

    // Simulates an out-of-band deletion (brief §3): the object vanishes
    // from storage without the DB ever being told.
    await storage.deleteObject(asset.storageKey);

    const orphans = await withTenantContext(tenant.id, (tx) => findDbOrphans(tx, storage));
    expect(orphans).toEqual([
      { mediaAssetId: asset.id, storageKey: asset.storageKey, kind: "original" },
    ]);
  });

  it("reports a missing variant independently of the (still-present) original", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg(2000, 1500);

    const asset = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, { maxBytes: bytes.byteLength + 1 });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      return finalizeMediaUpload(tx, storage, intent.id);
    });

    const variants = asset.variants as Record<string, { storageKey: string } | undefined>;
    const thumbnailKey = variants.thumbnail?.storageKey;
    expect(thumbnailKey).toBeTruthy();
    if (thumbnailKey) await storage.deleteObject(thumbnailKey);

    const orphans = await withTenantContext(tenant.id, (tx) => findDbOrphans(tx, storage));
    expect(orphans).toEqual([
      { mediaAssetId: asset.id, storageKey: thumbnailKey, kind: "thumbnail" },
    ]);
    // The original itself is still fine — never conflated with the variant.
    expect(await storage.getObject(asset.storageKey)).not.toBeNull();
  });
});
