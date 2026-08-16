import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sites } from "@provence360/database";
import { getAdminDb } from "@provence360/database/admin";
import {
  createSite,
  createSiteRevision,
  createTenant,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";

// Proves the migration-0010 composite foreign key
// (sites(tenant_id, id, published_revision_id) -> site_revisions(tenant_id,
// site_id, id), ON DELETE RESTRICT — see schema.ts and migration 0010's own
// comment) at the database level, independent of RLS and independent of
// every application-level check in packages/publishing. Every "must be
// rejected" case here is exercised via the admin (RLS-bypassing) connection
// specifically — if these still fail with an RLS-bypassing role, the only
// possible cause is the FK constraint itself, not a coincidence of Row-Level
// Security. A second pass repeats the two negative cases through the real
// app-role/tenant-context path, to prove RLS doesn't already hide them on
// its own (i.e. that the FK is doing real, necessary work, not redundant
// work) and that the real `publishRevision` write path would also be
// stopped, not just a hypothetical raw query.

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

function isForeignKeyViolation(error: unknown): boolean {
  // drizzle-orm/postgres-js wraps the driver error; the real Postgres
  // error (code 23503 = foreign_key_violation) is on `.cause`.
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  return cause?.code === "23503";
}

describe("DB constraint: sites_published_revision_tenant_site_fk (admin connection — pure FK, no RLS involved)", () => {
  it("Cas 1 — cross-tenant: rejects Site A's published_revision_id pointing at Tenant B's Revision", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteA = await createSite({ tenantId: tenantA.id });
    const siteB = await createSite({ tenantId: tenantB.id });
    const revisionB = await createSiteRevision({ tenantId: tenantB.id, siteId: siteB.id });

    const db = getAdminDb();
    let caught: unknown;
    try {
      await db
        .update(sites)
        .set({ publishedRevisionId: revisionB.id })
        .where(eq(sites.id, siteA.id));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(isForeignKeyViolation(caught)).toBe(true);

    const [reloaded] = await db.select().from(sites).where(eq(sites.id, siteA.id));
    expect(reloaded?.publishedRevisionId).toBeNull();
  });

  it("Cas 2 — same tenant, wrong Site: rejects Site A's published_revision_id pointing at Site B's Revision", async () => {
    const tenant = await createTenant();
    const siteA = await createSite({ tenantId: tenant.id });
    const siteB = await createSite({ tenantId: tenant.id });
    const revisionB = await createSiteRevision({ tenantId: tenant.id, siteId: siteB.id });

    const db = getAdminDb();
    let caught: unknown;
    try {
      await db
        .update(sites)
        .set({ publishedRevisionId: revisionB.id })
        .where(eq(sites.id, siteA.id));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(isForeignKeyViolation(caught)).toBe(true);

    const [reloaded] = await db.select().from(sites).where(eq(sites.id, siteA.id));
    expect(reloaded?.publishedRevisionId).toBeNull();
  });

  it("Cas 3 — correct tenant and Site: accepts the assignment", async () => {
    const tenant = await createTenant();
    const siteA = await createSite({ tenantId: tenant.id });
    const revisionA = await createSiteRevision({ tenantId: tenant.id, siteId: siteA.id });

    const db = getAdminDb();
    await db.update(sites).set({ publishedRevisionId: revisionA.id }).where(eq(sites.id, siteA.id));

    const [reloaded] = await db.select().from(sites).where(eq(sites.id, siteA.id));
    expect(reloaded?.publishedRevisionId).toBe(revisionA.id);
  });

  it("allows published_revision_id to be NULL (never-published Site)", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });

    const db = getAdminDb();
    const [row] = await db.select().from(sites).where(eq(sites.id, site.id));
    expect(row?.publishedRevisionId).toBeNull();

    // Explicit no-op NULL write must not be rejected either.
    await expect(
      db.update(sites).set({ publishedRevisionId: null }).where(eq(sites.id, site.id)),
    ).resolves.toBeDefined();
  });

  it("ON DELETE RESTRICT: the admin connection cannot delete a Revision that is currently published", async () => {
    const tenant = await createTenant();
    const site = await createSite({ tenantId: tenant.id });
    const revision = await createSiteRevision({ tenantId: tenant.id, siteId: site.id });

    const db = getAdminDb();
    await db.update(sites).set({ publishedRevisionId: revision.id }).where(eq(sites.id, site.id));

    const { siteRevisions } = await import("@provence360/database");
    let caught: unknown;
    try {
      await db.delete(siteRevisions).where(eq(siteRevisions.id, revision.id));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(isForeignKeyViolation(caught)).toBe(true);
  });
});

describe("DB constraint via the real app-role / tenant-context write path (proves RLS alone would NOT have caught these)", () => {
  it("Cas 1 (app role): tenant A updating its OWN site to point at tenant B's revision is refused by the FK, not RLS", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const siteA = await createSite({ tenantId: tenantA.id });
    const siteB = await createSite({ tenantId: tenantB.id });
    const revisionB = await createSiteRevision({ tenantId: tenantB.id, siteId: siteB.id });

    // RLS alone would ALLOW this statement to run: tenant A is updating a
    // row it owns (siteA), under its own tenant context. Only the FK stops it.
    let caught: unknown;
    try {
      await withTenantContext(tenantA.id, (tx) =>
        tx.update(sites).set({ publishedRevisionId: revisionB.id }).where(eq(sites.id, siteA.id)),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(isForeignKeyViolation(caught)).toBe(true);
  });

  it("Cas 2 (app role): same tenant, wrong Site is refused by the FK even though RLS's tenant match passes", async () => {
    const tenant = await createTenant();
    const siteA = await createSite({ tenantId: tenant.id });
    const siteB = await createSite({ tenantId: tenant.id });
    const revisionB = await createSiteRevision({ tenantId: tenant.id, siteId: siteB.id });

    let caught: unknown;
    try {
      await withTenantContext(tenant.id, (tx) =>
        tx.update(sites).set({ publishedRevisionId: revisionB.id }).where(eq(sites.id, siteA.id)),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(isForeignKeyViolation(caught)).toBe(true);
  });
});
