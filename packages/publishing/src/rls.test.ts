import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { siteRevisions, sitePublications } from "@provence360/database";
import {
  createSite,
  createSiteRevision,
  createTenant,
  ensureTestDatabaseReady,
  publishRevisionForTest,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";

// Real-Postgres RLS tests for the v0.4 tables, exercised with raw queries
// against `provence360_app` (via withTenantContext) — deliberately
// bypassing packages/publishing's own domain functions, which already
// re-derive everything through a tenant-scoped read. The point here is to
// prove the database-level boundary itself, independent of any
// application code ever getting it right.

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("RLS: site_revisions / site_publications", () => {
  it("tenant A cannot read tenant B's revisions, even by guessing the exact row id", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await createSite({ tenantId: tenantB.id });
    const revisionB = await createSiteRevision({ tenantId: tenantB.id, siteId: siteB.id });

    const rows = await withTenantContext(tenantA.id, (tx) =>
      tx.select().from(siteRevisions).where(eq(siteRevisions.id, revisionB.id)),
    );
    expect(rows).toHaveLength(0);
  });

  it("tenant A cannot read tenant B's publication history", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await createSite({ tenantId: tenantB.id });
    const revisionB = await createSiteRevision({ tenantId: tenantB.id, siteId: siteB.id });
    const publicationB = await publishRevisionForTest({
      tenantId: tenantB.id,
      siteId: siteB.id,
      revisionId: revisionB.id,
    });

    const rows = await withTenantContext(tenantA.id, (tx) =>
      tx.select().from(sitePublications).where(eq(sitePublications.id, publicationB.id)),
    );
    expect(rows).toHaveLength(0);
  });

  it("a query with no tenant context at all sees nothing (fail closed)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    await createSiteRevision({ tenantId: tenant.id, siteId: site.id });

    const { getAppDb } = await import("@provence360/database/client-app");
    const rows = await getAppDb().select().from(siteRevisions);
    expect(rows).toHaveLength(0);
  });

  it("provence360_app cannot INSERT a revision claiming a different tenant's tenant_id than its own context (withCheck)", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteB = await createSite({ tenantId: tenantB.id });

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        tx.insert(siteRevisions).values({
          tenantId: tenantB.id,
          siteId: siteB.id,
          revisionNumber: 1,
          snapshot: {},
        }),
      ),
    ).rejects.toThrow();
  });

  it("provence360_app cannot UPDATE a revision it owns — no UPDATE policy exists, so RLS makes the row invisible to the UPDATE's target set (0 rows affected, row unchanged) rather than raising an error (Invariant D)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const revision = await createSiteRevision({ tenantId: tenant.id, siteId: site.id });

    const updated = await withTenantContext(tenant.id, (tx) =>
      tx
        .update(siteRevisions)
        .set({ revisionNumber: 999 })
        .where(eq(siteRevisions.id, revision.id))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const { getAdminDb } = await import("@provence360/database/admin");
    const [stillOriginal] = await getAdminDb()
      .select()
      .from(siteRevisions)
      .where(eq(siteRevisions.id, revision.id));
    expect(stillOriginal?.revisionNumber).toBe(revision.revisionNumber);
  });

  it("provence360_app cannot DELETE a revision it owns — append-only at the database level (0 rows affected, row still exists)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const revision = await createSiteRevision({ tenantId: tenant.id, siteId: site.id });

    const deleted = await withTenantContext(tenant.id, (tx) =>
      tx.delete(siteRevisions).where(eq(siteRevisions.id, revision.id)).returning(),
    );
    expect(deleted).toHaveLength(0);

    const { getAdminDb } = await import("@provence360/database/admin");
    const [stillExists] = await getAdminDb()
      .select()
      .from(siteRevisions)
      .where(eq(siteRevisions.id, revision.id));
    expect(stillExists).toBeDefined();
  });

  it("provence360_app cannot UPDATE or DELETE a publication row — append-only history", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const revision = await createSiteRevision({ tenantId: tenant.id, siteId: site.id });
    const publication = await publishRevisionForTest({
      tenantId: tenant.id,
      siteId: site.id,
      revisionId: revision.id,
    });

    const updated = await withTenantContext(tenant.id, (tx) =>
      tx
        .update(sitePublications)
        .set({ action: "rollback" })
        .where(eq(sitePublications.id, publication.id))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenantContext(tenant.id, (tx) =>
      tx.delete(sitePublications).where(eq(sitePublications.id, publication.id)).returning(),
    );
    expect(deleted).toHaveLength(0);

    const { getAdminDb } = await import("@provence360/database/admin");
    const [stillExists] = await getAdminDb()
      .select()
      .from(sitePublications)
      .where(eq(sitePublications.id, publication.id));
    expect(stillExists?.action).toBe("publish");
  });
});
