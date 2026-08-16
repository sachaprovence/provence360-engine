import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sessions, tenants } from "@provence360/database";
import { getAdminDb } from "@provence360/database/admin";
import {
  createMembership,
  createTenant,
  createUser,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { getCurrentTenantId } from "@provence360/tenant";
import { AuthenticationError, AuthorizationError } from "./errors";
import { createSession, generateSessionToken, revokeSessionToken } from "./session";
import { withAuthorizedTenantContext } from "./with-authorized-tenant-context";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("withAuthorizedTenantContext", () => {
  it("refuses a request with no session token at all", async () => {
    const tenant = await createTenant();

    await expect(
      withAuthorizedTenantContext(
        { sessionToken: "", tenantId: tenant.id },
        async (_tx, actor) => actor,
      ),
    ).rejects.toThrow(AuthenticationError);
  });

  it("refuses an unknown session token", async () => {
    const tenant = await createTenant();

    await expect(
      withAuthorizedTenantContext(
        { sessionToken: generateSessionToken(), tenantId: tenant.id },
        async (_tx, actor) => actor,
      ),
    ).rejects.toThrow(AuthenticationError);
  });

  it("refuses a revoked session", async () => {
    const tenant = await createTenant();
    const user = await createUser();
    await createMembership({ tenantId: tenant.id, userId: user.id, role: "owner" });
    const { token } = await createSession(user.id);
    await revokeSessionToken(token);

    await expect(
      withAuthorizedTenantContext(
        { sessionToken: token, tenantId: tenant.id },
        async (_tx, actor) => actor,
      ),
    ).rejects.toThrow(AuthenticationError);
  });

  it("refuses an expired session", async () => {
    const tenant = await createTenant();
    const user = await createUser();
    await createMembership({ tenantId: tenant.id, userId: user.id, role: "owner" });
    const { token } = await createSession(user.id);
    await getAdminDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, user.id));

    await expect(
      withAuthorizedTenantContext(
        { sessionToken: token, tenantId: tenant.id },
        async (_tx, actor) => actor,
      ),
    ).rejects.toThrow(AuthenticationError);
  });

  it("refuses a malformed (non-UUID) tenantId, authenticated or not", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);

    await expect(
      withAuthorizedTenantContext(
        { sessionToken: token, tenantId: "../../etc/passwd" },
        async (_tx, actor) => actor,
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it("refuses a well-formed but non-existent tenantId", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);

    await expect(
      withAuthorizedTenantContext(
        { sessionToken: token, tenantId: randomUUID() },
        async (_tx, actor) => actor,
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it("refuses a tenant the authenticated user has no membership in — even knowing its real UUID", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const user = await createUser();
    await createMembership({ tenantId: tenantA.id, userId: user.id, role: "owner" });
    const { token } = await createSession(user.id);

    // The user is legitimately authenticated and owns tenant A — but is
    // simply trying tenant B's real id (e.g. a tampered URL segment).
    await expect(
      withAuthorizedTenantContext(
        { sessionToken: token, tenantId: tenantB.id },
        async (_tx, actor) => actor,
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it("refuses a suspended tenant even for its own member", async () => {
    const tenant = await createTenant({ status: "suspended" });
    const user = await createUser();
    await createMembership({ tenantId: tenant.id, userId: user.id, role: "owner" });
    const { token } = await createSession(user.id);

    await expect(
      withAuthorizedTenantContext(
        { sessionToken: token, tenantId: tenant.id },
        async (_tx, actor) => actor,
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it("enforces the requested permission against the membership's role", async () => {
    const tenant = await createTenant();
    const user = await createUser();
    await createMembership({ tenantId: tenant.id, userId: user.id, role: "member" });
    const { token } = await createSession(user.id);

    await expect(
      withAuthorizedTenantContext(
        { sessionToken: token, tenantId: tenant.id, permission: "site.create" },
        async (_tx, actor) => actor,
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it("succeeds for an authenticated member with a valid membership and sufficient permission", async () => {
    const tenant = await createTenant();
    const user = await createUser();
    const membership = await createMembership({
      tenantId: tenant.id,
      userId: user.id,
      role: "admin",
    });
    const { token } = await createSession(user.id);

    const actor = await withAuthorizedTenantContext(
      { sessionToken: token, tenantId: tenant.id, permission: "site.create" },
      async (_tx, actor) => actor,
    );

    expect(actor.userId).toBe(user.id);
    expect(actor.tenantId).toBe(tenant.id);
    expect(actor.membershipId).toBe(membership.id);
    expect(actor.role).toBe("admin");
    expect(actor.permissions.has("site.create")).toBe(true);
    expect(actor.permissions.has("tenant.update")).toBe(false);
  });

  it("the callback runs inside a real tenant context — data reads are RLS-scoped to that tenant", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const user = await createUser();
    await createMembership({ tenantId: tenantA.id, userId: user.id, role: "owner" });
    const { token } = await createSession(user.id);

    const visibleTenantIds = await withAuthorizedTenantContext(
      { sessionToken: token, tenantId: tenantA.id },
      async (tx) => {
        expect(getCurrentTenantId()).toBe(tenantA.id);
        const rows = await tx.select({ id: tenants.id }).from(tenants);
        return rows.map((r) => r.id);
      },
    );

    expect(visibleTenantIds).toEqual([tenantA.id]);
    expect(visibleTenantIds).not.toContain(tenantB.id);
  });

  it("switching tenants (two separate calls, same session) never leaks the other tenant's data", async () => {
    const tenantA = await createTenant({ name: "Tenant A" });
    const tenantB = await createTenant({ name: "Tenant B" });
    const user = await createUser();
    await createMembership({ tenantId: tenantA.id, userId: user.id, role: "owner" });
    await createMembership({ tenantId: tenantB.id, userId: user.id, role: "owner" });
    const { token } = await createSession(user.id);

    const rowsForA = await withAuthorizedTenantContext(
      { sessionToken: token, tenantId: tenantA.id },
      async (tx) => tx.select({ id: tenants.id }).from(tenants),
    );
    const rowsForB = await withAuthorizedTenantContext(
      { sessionToken: token, tenantId: tenantB.id },
      async (tx) => tx.select({ id: tenants.id }).from(tenants),
    );

    expect(rowsForA.map((r) => r.id)).toEqual([tenantA.id]);
    expect(rowsForB.map((r) => r.id)).toEqual([tenantB.id]);
  });

  it("logout (revoking the session) immediately invalidates further authorized access", async () => {
    const tenant = await createTenant();
    const user = await createUser();
    await createMembership({ tenantId: tenant.id, userId: user.id, role: "owner" });
    const { token } = await createSession(user.id);

    await withAuthorizedTenantContext(
      { sessionToken: token, tenantId: tenant.id },
      async () => undefined,
    );

    await revokeSessionToken(token);

    await expect(
      withAuthorizedTenantContext(
        { sessionToken: token, tenantId: tenant.id },
        async () => undefined,
      ),
    ).rejects.toThrow(AuthenticationError);
  });
});
