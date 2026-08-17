import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAdminDb } from "@provence360/database/admin";
import { mediaUploads } from "@provence360/database";
import { eq } from "drizzle-orm";
import { createTenant, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import {
  MediaUploadAlreadyFinalizedError,
  MediaUploadExpiredError,
  MediaUploadNotFoundError,
} from "../errors";
import {
  claimMediaUploadForFinalize,
  createMediaUploadIntent,
  expireOverdueMediaUploads,
  getMediaUploadIntent,
  listExpiredPendingMediaUploads,
  markMediaUploadFailed,
} from "./media-upload-repository";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("createMediaUploadIntent / getMediaUploadIntent", () => {
  it("creates a pending intent with a server-generated, tenant-namespaced storage key", async () => {
    const tenant = await createTenant();
    const intent = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    expect(intent.status).toBe("pending");
    expect(intent.storageKey).toContain(`tenants/${tenant.id}/`);
    expect(intent.mediaAssetId).toBeNull();

    const fetched = await withTenantContext(tenant.id, (tx) => getMediaUploadIntent(tx, intent.id));
    expect(fetched.id).toBe(intent.id);
  });

  it("throws MediaUploadNotFoundError for an id that doesn't exist", async () => {
    const tenant = await createTenant();
    await expect(
      withTenantContext(tenant.id, (tx) => getMediaUploadIntent(tx, crypto.randomUUID())),
    ).rejects.toThrow(MediaUploadNotFoundError);
  });

  it("a tenant can never read another tenant's upload intent", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const intent = await withTenantContext(tenantA.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    await expect(
      withTenantContext(tenantB.id, (tx) => getMediaUploadIntent(tx, intent.id)),
    ).rejects.toThrow(MediaUploadNotFoundError);
  });
});

describe("claimMediaUploadForFinalize", () => {
  it("claims a pending, unexpired intent", async () => {
    const tenant = await createTenant();
    const intent = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    const claimed = await withTenantContext(tenant.id, (tx) =>
      claimMediaUploadForFinalize(tx, intent.id),
    );
    expect(claimed.id).toBe(intent.id);
  });

  it("throws MediaUploadAlreadyFinalizedError for a non-pending intent (already failed/finalized/expired)", async () => {
    const tenant = await createTenant();
    const intent = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    await getAdminDb()
      .update(mediaUploads)
      .set({ status: "failed" })
      .where(eq(mediaUploads.id, intent.id));

    await expect(
      withTenantContext(tenant.id, (tx) => claimMediaUploadForFinalize(tx, intent.id)),
    ).rejects.toThrow(MediaUploadAlreadyFinalizedError);
  });

  it("throws MediaUploadExpiredError for a pending intent past its TTL", async () => {
    const tenant = await createTenant();
    const intent = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    await getAdminDb()
      .update(mediaUploads)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(mediaUploads.id, intent.id));

    await expect(
      withTenantContext(tenant.id, (tx) => claimMediaUploadForFinalize(tx, intent.id)),
    ).rejects.toThrow(MediaUploadExpiredError);
  });

  it("a tenant can never claim another tenant's upload intent", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const intent = await withTenantContext(tenantA.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    await expect(
      withTenantContext(tenantB.id, (tx) => claimMediaUploadForFinalize(tx, intent.id)),
    ).rejects.toThrow(MediaUploadNotFoundError);
  });
});

describe("markMediaUploadFailed / markMediaUploadFinalized", () => {
  it("markMediaUploadFailed transitions status to failed", async () => {
    const tenant = await createTenant();
    const intent = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    await withTenantContext(tenant.id, (tx) => markMediaUploadFailed(tx, intent.id));
    const fetched = await withTenantContext(tenant.id, (tx) => getMediaUploadIntent(tx, intent.id));
    expect(fetched.status).toBe("failed");
  });
});

describe("listExpiredPendingMediaUploads / expireOverdueMediaUploads", () => {
  it("lists only pending intents whose TTL has passed", async () => {
    const tenant = await createTenant();
    const fresh = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    const stale = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    await getAdminDb()
      .update(mediaUploads)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(mediaUploads.id, stale.id));

    const expired = await withTenantContext(tenant.id, (tx) => listExpiredPendingMediaUploads(tx));
    expect(expired.map((u) => u.id)).toEqual([stale.id]);
    expect(expired.map((u) => u.id)).not.toContain(fresh.id);
  });

  it("expireOverdueMediaUploads is idempotent — a second call matches nothing new", async () => {
    const tenant = await createTenant();
    const stale = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    await getAdminDb()
      .update(mediaUploads)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(mediaUploads.id, stale.id));

    const first = await withTenantContext(tenant.id, (tx) => expireOverdueMediaUploads(tx));
    const second = await withTenantContext(tenant.id, (tx) => expireOverdueMediaUploads(tx));
    expect(first).toBe(1);
    expect(second).toBe(0);

    const fetched = await withTenantContext(tenant.id, (tx) => getMediaUploadIntent(tx, stale.id));
    expect(fetched.status).toBe("expired");
  });
});

describe("DB CHECK constraint: media_uploads_finalized_has_asset_ck", () => {
  it("the database itself rejects a finalized row with no media asset id", async () => {
    const tenant = await createTenant();
    const intent = await withTenantContext(tenant.id, (tx) =>
      createMediaUploadIntent(tx, { maxBytes: 1000 }),
    );
    await expect(
      getAdminDb()
        .update(mediaUploads)
        .set({ status: "finalized", mediaAssetId: null })
        .where(eq(mediaUploads.id, intent.id)),
    ).rejects.toThrow();
  });
});
