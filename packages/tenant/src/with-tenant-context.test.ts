import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tenants, users } from "@provence360/database";
import { getAppDb } from "@provence360/database/client-app";
import {
  createMembership,
  createTenant,
  createUser,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { getCurrentTenantId } from "./context";
import { withTenantContext } from "./with-tenant-context";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("getCurrentTenantId", () => {
  it("is undefined outside of any withTenantContext call", () => {
    expect(getCurrentTenantId()).toBeUndefined();
  });

  it("reflects the active tenant inside the callback, and clears afterwards", async () => {
    const tenant = await createTenant();

    await withTenantContext(tenant.id, async () => {
      expect(getCurrentTenantId()).toBe(tenant.id);
    });

    expect(getCurrentTenantId()).toBeUndefined();
  });
});

describe("withTenantContext", () => {
  it("rejects a non-UUID tenant id before touching the database", async () => {
    await expect(withTenantContext("not-a-uuid", async () => "unreachable")).rejects.toThrow(
      /not a valid tenant id/,
    );
  });

  it("lets a tenant read its own row", async () => {
    const tenant = await createTenant({ name: "Villas Cassis" });

    const row = await withTenantContext(tenant.id, async (tx) => {
      const [result] = await tx.select().from(tenants).where(eq(tenants.id, tenant.id));
      return result;
    });

    expect(row?.name).toBe("Villas Cassis");
  });

  it("cannot read another tenant's row, even knowing its UUID", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    const rows = await withTenantContext(tenantA.id, async (tx) =>
      tx.select().from(tenants).where(eq(tenants.id, tenantB.id)),
    );

    expect(rows).toHaveLength(0);
  });

  it("cannot update another tenant's row", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant({ name: "Original Name" });

    await withTenantContext(tenantA.id, async (tx) => {
      await tx.update(tenants).set({ name: "Hijacked" }).where(eq(tenants.id, tenantB.id));
    });

    const stillOriginal = await withTenantContext(tenantB.id, async (tx) => {
      const [result] = await tx.select().from(tenants).where(eq(tenants.id, tenantB.id));
      return result;
    });

    expect(stillOriginal?.name).toBe("Original Name");
  });

  it("cannot delete another tenant's row", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    await withTenantContext(tenantA.id, async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, tenantB.id));
    });

    const stillExists = await withTenantContext(tenantB.id, async (tx) => {
      const [result] = await tx.select().from(tenants).where(eq(tenants.id, tenantB.id));
      return result;
    });

    expect(stillExists).toBeDefined();
  });

  it("fails closed: a query issued with no tenant context at all returns no rows", async () => {
    await createTenant();

    const rows = await getAppDb().select().from(tenants);

    expect(rows).toHaveLength(0);
  });

  it("does not leak app.tenant_id onto a connection reused for a different tenant", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    await withTenantContext(tenantA.id, async (tx) => {
      const [self] = await tx.select().from(tenants).where(eq(tenants.id, tenantA.id));
      expect(self).toBeDefined();
    });

    // A brand new withTenantContext call may or may not reuse the same
    // pooled connection under the hood — either way it must only ever see
    // tenant B's own data, never a stale app.tenant_id from tenant A.
    const rows = await withTenantContext(tenantB.id, async (tx) => tx.select().from(tenants));

    expect(rows.map((r) => r.id)).toEqual([tenantB.id]);
  });
});

describe("users RLS (no tenant_id column — visibility via memberships)", () => {
  it("a tenant can see a user it has a membership with", async () => {
    const tenant = await createTenant();
    const user = await createUser();
    await createMembership({ tenantId: tenant.id, userId: user.id });

    // provence360_app is only granted a subset of columns (never
    // password_hash — see migrations/0003_auth_role_grants.sql), so tests
    // exercising this role select the same columns real app code would.
    const rows = await withTenantContext(tenant.id, (tx) =>
      tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, user.id)),
    );

    expect(rows).toHaveLength(1);
  });

  it("a tenant cannot see a user it has no membership with, even knowing its UUID", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const userB = await createUser();
    await createMembership({ tenantId: tenantB.id, userId: userB.id });

    const rows = await withTenantContext(tenantA.id, (tx) =>
      tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userB.id)),
    );

    expect(rows).toHaveLength(0);
  });

  it("a contractor with memberships in two tenants is visible to both", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const contractor = await createUser();
    await createMembership({ tenantId: tenantA.id, userId: contractor.id });
    await createMembership({ tenantId: tenantB.id, userId: contractor.id });

    const visibleToA = await withTenantContext(tenantA.id, (tx) =>
      tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, contractor.id)),
    );
    const visibleToB = await withTenantContext(tenantB.id, (tx) =>
      tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, contractor.id)),
    );

    expect(visibleToA).toHaveLength(1);
    expect(visibleToB).toHaveLength(1);
  });

  it("regression: provence360_app can never read users.password_hash, even inside a valid tenant context", async () => {
    const tenant = await createTenant();
    const user = await createUser();
    await createMembership({ tenantId: tenant.id, userId: user.id });

    // Selecting the whole row (as opposed to an explicit column list) is
    // exactly how a future careless call site would accidentally try to
    // read password_hash. It must fail at the grant level, not just be
    // "unused" by convention — see migrations/0003_auth_role_grants.sql.
    // drizzle-postgres wraps the driver error as `Failed query: ...` and
    // puts the actual Postgres error (with the real message) on `.cause`.
    let caught: unknown;
    try {
      await withTenantContext(tenant.id, (tx) =>
        tx.select().from(users).where(eq(users.id, user.id)),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).cause)).toMatch(/permission denied for table users/);
  });
});
