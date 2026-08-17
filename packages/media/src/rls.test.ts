import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mediaUploads } from "@provence360/database";
import { createTenant, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";

// Real-Postgres RLS tests for `media_uploads` — deliberately bypassing
// `packages/media`'s own repository functions, which already re-derive
// everything through a tenant-scoped read. The point here is to prove the
// database-level boundary itself, independent of any application code
// ever getting it right — same pattern as packages/virtual-tours' and
// packages/rentals' own rls.test.ts files (brief §20: "pas seulement un
// test d'API").

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("RLS: media_uploads", () => {
  it("tenant A cannot read tenant B's upload intent, even by guessing the exact row id", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const { getAdminDb } = await import("@provence360/database/admin");
    const [rowB] = await getAdminDb()
      .insert(mediaUploads)
      .values({
        tenantId: tenantB.id,
        storageKey: `tenants/${tenantB.id}/media/uploads/forged`,
        maxBytes: 1000,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!rowB) throw new Error("Failed to create test upload intent");

    const rows = await withTenantContext(tenantA.id, (tx) =>
      tx.select().from(mediaUploads).where(eq(mediaUploads.id, rowB.id)),
    );
    expect(rows).toHaveLength(0);
  });

  it("a query with no tenant context at all sees nothing (fail closed)", async () => {
    const tenant = await createTenant();
    const { getAdminDb } = await import("@provence360/database/admin");
    await getAdminDb()
      .insert(mediaUploads)
      .values({
        tenantId: tenant.id,
        storageKey: `tenants/${tenant.id}/media/uploads/x`,
        maxBytes: 1000,
        expiresAt: new Date(Date.now() + 60_000),
      });

    const { getAppDb } = await import("@provence360/database/client-app");
    const rows = await getAppDb().select().from(mediaUploads);
    expect(rows).toHaveLength(0);
  });

  it("provence360_app cannot INSERT a row claiming a different tenant's tenant_id than its own context (withCheck)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        tx.insert(mediaUploads).values({
          tenantId: tenantB.id,
          storageKey: `tenants/${tenantB.id}/media/uploads/forged`,
          maxBytes: 1000,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    ).rejects.toThrow();
  });

  it("tenant A cannot finalize (UPDATE) tenant B's upload intent", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const { getAdminDb } = await import("@provence360/database/admin");
    const [rowB] = await getAdminDb()
      .insert(mediaUploads)
      .values({
        tenantId: tenantB.id,
        storageKey: `tenants/${tenantB.id}/media/uploads/forged`,
        maxBytes: 1000,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!rowB) throw new Error("Failed to create test upload intent");

    const updated = await withTenantContext(tenantA.id, (tx) =>
      tx
        .update(mediaUploads)
        .set({ status: "failed" })
        .where(eq(mediaUploads.id, rowB.id))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    // Confirm B's row is genuinely untouched, not just invisible.
    const stillPending = await getAdminDb()
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.id, rowB.id));
    expect(stillPending[0]?.status).toBe("pending");
  });

  it("rejects a non-positive maxBytes (CHECK constraint)", async () => {
    const tenant = await createTenant();
    await expect(
      withTenantContext(tenant.id, (tx) =>
        tx.insert(mediaUploads).values({
          tenantId: tenant.id,
          storageKey: `tenants/${tenant.id}/media/uploads/x`,
          maxBytes: 0,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a finalized row with no media_asset_id (CHECK constraint media_uploads_finalized_has_asset_ck)", async () => {
    const tenant = await createTenant();
    await expect(
      withTenantContext(tenant.id, (tx) =>
        tx.insert(mediaUploads).values({
          tenantId: tenant.id,
          storageKey: `tenants/${tenant.id}/media/uploads/x`,
          maxBytes: 1000,
          expiresAt: new Date(Date.now() + 60_000),
          status: "finalized",
        }),
      ),
    ).rejects.toThrow();
  });
});
