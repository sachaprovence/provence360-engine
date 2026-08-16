import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@provence360/database";
import { getAdminDb } from "@provence360/database/admin";
import { getAuthDb } from "@provence360/database/client-auth";
import {
  createTenant,
  createUser,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { AUTH_LOGIN_SUCCESS } from "./audit-events";
import { recordAuthAuditEvent } from "./audit";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("recordAuthAuditEvent", () => {
  it("always writes tenantId null, regardless of what a caller might try to imply", async () => {
    const user = await createUser();

    await recordAuthAuditEvent({
      actorUserId: user.id,
      action: AUTH_LOGIN_SUCCESS,
      targetType: "user",
      targetId: user.id,
      metadata: { note: "no secrets here" },
    });

    const [row] = await getAdminDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, AUTH_LOGIN_SUCCESS));
    expect(row?.tenantId).toBeNull();
  });

  it("regression: provence360_auth is structurally unable to insert a tenant-scoped audit row", async () => {
    const tenant = await createTenant();

    // recordAuthAuditEvent has no tenantId parameter by design, but this
    // guards the underlying grant/RLS policy directly: even a hand-crafted
    // insert through the auth role's own connection must be rejected by
    // the `auth_insert_audit_logs` policy (`WITH CHECK tenant_id IS NULL`),
    // not merely "unreachable" through the current API surface.
    await expect(
      getAuthDb().insert(auditLogs).values({
        tenantId: tenant.id,
        action: AUTH_LOGIN_SUCCESS,
        targetType: "user",
        metadata: {},
      }),
    ).rejects.toThrow();
  });

  it("regression: provence360_auth cannot read tenant-scoped audit rows, only tenant_id IS NULL ones", async () => {
    const tenant = await createTenant();
    await getAdminDb()
      .insert(auditLogs)
      .values({ tenantId: tenant.id, action: "SITE_CREATED", targetType: "site", metadata: {} });
    await getAdminDb()
      .insert(auditLogs)
      .values({ tenantId: null, action: AUTH_LOGIN_SUCCESS, targetType: "user", metadata: {} });

    const rows = await getAuthDb().select().from(auditLogs);
    expect(rows.every((r) => r.tenantId === null)).toBe(true);
    expect(rows.some((r) => r.action === AUTH_LOGIN_SUCCESS)).toBe(true);
  });
});
