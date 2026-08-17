import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mediaUploads } from "@provence360/database";
import { createTenant, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { cleanupExpiredMediaUploads } from "./cleanup";
import {
  createMediaUploadIntent,
  getMediaUploadIntent,
} from "./repository/media-upload-repository";
import { MemoryObjectStorage } from "./storage/memory-object-storage";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("cleanupExpiredMediaUploads", () => {
  it("marks an expired pending intent as expired and deletes its temporary storage object", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();

    const intent = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    await storage.putObject(intent.storageKey, Buffer.from("abandoned upload"), {
      contentType: "image/jpeg",
    });

    const { getAdminDb } = await import("@provence360/database/admin");
    await getAdminDb()
      .update(mediaUploads)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(mediaUploads.id, intent.id));

    const result = await withTenantContext(tenant.id, (tx) =>
      cleanupExpiredMediaUploads(tx, storage),
    );
    expect(result.expiredCount).toBe(1);

    const fetched = await withTenantContext(tenant.id, (tx) => getMediaUploadIntent(tx, intent.id));
    expect(fetched.status).toBe("expired");
    expect(await storage.getObject(intent.storageKey)).toBeNull();
  });

  it("leaves a fresh (not-yet-expired) pending intent untouched", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const intent = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    await storage.putObject(intent.storageKey, Buffer.from("still valid"), {
      contentType: "image/jpeg",
    });

    const result = await withTenantContext(tenant.id, (tx) =>
      cleanupExpiredMediaUploads(tx, storage),
    );
    expect(result.expiredCount).toBe(0);

    const fetched = await withTenantContext(tenant.id, (tx) => getMediaUploadIntent(tx, intent.id));
    expect(fetched.status).toBe("pending");
    expect(await storage.getObject(intent.storageKey)).not.toBeNull();
  });

  it("is idempotent — running it twice never double-counts or errors", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const intent = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    const { getAdminDb } = await import("@provence360/database/admin");
    await getAdminDb()
      .update(mediaUploads)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(mediaUploads.id, intent.id));

    const first = await withTenantContext(tenant.id, (tx) =>
      cleanupExpiredMediaUploads(tx, storage),
    );
    const second = await withTenantContext(tenant.id, (tx) =>
      cleanupExpiredMediaUploads(tx, storage),
    );
    expect(first.expiredCount).toBe(1);
    expect(second.expiredCount).toBe(0);
  });

  it("never touches another tenant's expired uploads", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const storage = new MemoryObjectStorage();

    const intentB = await withTenantContext(tenantB.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    const { getAdminDb } = await import("@provence360/database/admin");
    await getAdminDb()
      .update(mediaUploads)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(mediaUploads.id, intentB.id));

    const resultA = await withTenantContext(tenantA.id, (tx) =>
      cleanupExpiredMediaUploads(tx, storage),
    );
    expect(resultA.expiredCount).toBe(0);

    const fetchedB = await withTenantContext(tenantB.id, (tx) =>
      getMediaUploadIntent(tx, intentB.id),
    );
    expect(fetchedB.status).toBe("pending");
  });
});
