import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenant, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { MediaAssetNotFoundError } from "./errors";
import {
  createMediaAsset,
  deleteMediaAsset,
  getMediaAsset,
  listMediaAssetsByIds,
} from "./media-repository";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("createMediaAsset / getMediaAsset", () => {
  it("creates a media asset under the current tenant and can read it back", async () => {
    const tenant = await createTenant();

    const created = await withTenantContext(tenant.id, (tx) =>
      createMediaAsset(tx, {
        kind: "image",
        storageKey: "seed/villa/hero.jpg",
        mimeType: "image/jpeg",
      }),
    );
    expect(created.tenantId).toBe(tenant.id);

    const found = await withTenantContext(tenant.id, (tx) => getMediaAsset(tx, created.id));
    expect(found?.id).toBe(created.id);
  });

  it("does not let a tenant read another tenant's media asset", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    const created = await withTenantContext(tenantA.id, (tx) =>
      createMediaAsset(tx, { kind: "image", storageKey: "seed/a.jpg", mimeType: "image/jpeg" }),
    );

    const found = await withTenantContext(tenantB.id, (tx) => getMediaAsset(tx, created.id));
    expect(found).toBeNull();
  });
});

describe("deleteMediaAsset", () => {
  it("deletes a media asset owned by the current tenant", async () => {
    const tenant = await createTenant();
    const created = await withTenantContext(tenant.id, (tx) =>
      createMediaAsset(tx, { kind: "image", storageKey: "seed/a.jpg", mimeType: "image/jpeg" }),
    );

    await withTenantContext(tenant.id, (tx) => deleteMediaAsset(tx, created.id));

    const found = await withTenantContext(tenant.id, (tx) => getMediaAsset(tx, created.id));
    expect(found).toBeNull();
  });

  it("refuses to delete another tenant's media asset — knowing the id is not enough", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    const created = await withTenantContext(tenantA.id, (tx) =>
      createMediaAsset(tx, { kind: "image", storageKey: "seed/a.jpg", mimeType: "image/jpeg" }),
    );

    await expect(
      withTenantContext(tenantB.id, (tx) => deleteMediaAsset(tx, created.id)),
    ).rejects.toThrow(MediaAssetNotFoundError);

    // Still there, untouched, for its real owner.
    const found = await withTenantContext(tenantA.id, (tx) => getMediaAsset(tx, created.id));
    expect(found?.id).toBe(created.id);
  });
});

describe("listMediaAssetsByIds", () => {
  it("resolves only the requesting tenant's own ids, preserving no particular order guarantee beyond membership", async () => {
    const tenant = await createTenant();
    const a = await withTenantContext(tenant.id, (tx) =>
      createMediaAsset(tx, { kind: "image", storageKey: "seed/a.jpg", mimeType: "image/jpeg" }),
    );
    const b = await withTenantContext(tenant.id, (tx) =>
      createMediaAsset(tx, { kind: "image", storageKey: "seed/b.jpg", mimeType: "image/jpeg" }),
    );

    const found = await withTenantContext(tenant.id, (tx) =>
      listMediaAssetsByIds(tx, [a.id, b.id]),
    );
    expect(found.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("silently drops a cross-tenant id instead of returning it or throwing — a gallery block referencing another tenant's media resolves to nothing for that one entry", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    const own = await withTenantContext(tenantA.id, (tx) =>
      createMediaAsset(tx, { kind: "image", storageKey: "seed/mine.jpg", mimeType: "image/jpeg" }),
    );
    const other = await withTenantContext(tenantB.id, (tx) =>
      createMediaAsset(tx, {
        kind: "image",
        storageKey: "seed/theirs.jpg",
        mimeType: "image/jpeg",
      }),
    );

    const found = await withTenantContext(tenantA.id, (tx) =>
      listMediaAssetsByIds(tx, [own.id, other.id]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(own.id);
  });

  it("returns an empty array for an empty id list without querying", async () => {
    const tenant = await createTenant();
    const found = await withTenantContext(tenant.id, (tx) => listMediaAssetsByIds(tx, []));
    expect(found).toEqual([]);
  });
});
