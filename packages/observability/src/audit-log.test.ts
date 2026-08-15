import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@provence360/database";
import { createTenant, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { recordAuditLog } from "./audit-log";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("recordAuditLog", () => {
  it("records an entry under the current tenant and can read it back", async () => {
    const tenant = await createTenant();

    const entry = await withTenantContext(tenant.id, (tx) =>
      recordAuditLog(tx, { action: "site.created", targetType: "site" }),
    );
    expect(entry.tenantId).toBe(tenant.id);

    const rows = await withTenantContext(tenant.id, (tx) => tx.select().from(auditLogs));
    expect(rows).toHaveLength(1);
  });

  it("is invisible to another tenant", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    await withTenantContext(tenantA.id, (tx) =>
      recordAuditLog(tx, { action: "site.created", targetType: "site" }),
    );

    const rowsB = await withTenantContext(tenantB.id, (tx) => tx.select().from(auditLogs));
    expect(rowsB).toHaveLength(0);
  });

  it("cannot be updated by the app role, even by the owning tenant", async () => {
    const tenant = await createTenant();
    const entry = await withTenantContext(tenant.id, (tx) =>
      recordAuditLog(tx, { action: "site.created", targetType: "site" }),
    );

    // RLS with no permissive UPDATE policy doesn't throw — it filters the
    // target row out entirely, same as a WHERE clause that matches
    // nothing. The write silently affects zero rows rather than erroring;
    // what matters is that the row itself is provably unchanged.
    const updated = await withTenantContext(tenant.id, (tx) =>
      tx
        .update(auditLogs)
        .set({ action: "tampered" })
        .where(eq(auditLogs.id, entry.id))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const stillOriginal = await withTenantContext(tenant.id, async (tx) => {
      const [row] = await tx.select().from(auditLogs).where(eq(auditLogs.id, entry.id));
      return row;
    });
    expect(stillOriginal?.action).toBe("site.created");
  });

  it("cannot be deleted by the app role, even by the owning tenant", async () => {
    const tenant = await createTenant();
    const entry = await withTenantContext(tenant.id, (tx) =>
      recordAuditLog(tx, { action: "site.created", targetType: "site" }),
    );

    const deleted = await withTenantContext(tenant.id, (tx) =>
      tx.delete(auditLogs).where(eq(auditLogs.id, entry.id)).returning(),
    );
    expect(deleted).toHaveLength(0);

    const stillExists = await withTenantContext(tenant.id, async (tx) => {
      const [row] = await tx.select().from(auditLogs).where(eq(auditLogs.id, entry.id));
      return row;
    });
    expect(stillExists).toBeDefined();
  });
});
