import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMembership,
  createTenant,
  createUser,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { AuthorizationError, LastOwnerError, MembershipNotFoundError } from "./errors";
import { addMember, changeMemberRole, listMembers, removeMember } from "./membership-repository";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("addMember", () => {
  it("an OWNER can add another member as OWNER", async () => {
    const tenant = await createTenant();
    const newUser = await createUser();

    const row = await withTenantContext(tenant.id, (tx) =>
      addMember(tx, { userId: newUser.id, role: "owner", actingRole: "owner" }),
    );

    expect(row.role).toBe("owner");
  });

  it("an ADMIN cannot grant the OWNER role", async () => {
    const tenant = await createTenant();
    const newUser = await createUser();

    await expect(
      withTenantContext(tenant.id, (tx) =>
        addMember(tx, { userId: newUser.id, role: "owner", actingRole: "admin" }),
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it("an ADMIN can add a member as MEMBER or ADMIN", async () => {
    const tenant = await createTenant();
    const newUser = await createUser();

    const row = await withTenantContext(tenant.id, (tx) =>
      addMember(tx, { userId: newUser.id, role: "admin", actingRole: "admin" }),
    );

    expect(row.role).toBe("admin");
  });
});

describe("changeMemberRole", () => {
  it("an ADMIN cannot promote a member to OWNER", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await createMembership({ tenantId: tenant.id, userId: owner.id, role: "owner" });
    const member = await createUser();
    const membership = await createMembership({
      tenantId: tenant.id,
      userId: member.id,
      role: "member",
    });

    await expect(
      withTenantContext(tenant.id, (tx) =>
        changeMemberRole(tx, {
          membershipId: membership.id,
          newRole: "owner",
          actingRole: "admin",
        }),
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it("an OWNER can promote a member to OWNER", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await createMembership({ tenantId: tenant.id, userId: owner.id, role: "owner" });
    const member = await createUser();
    const membership = await createMembership({
      tenantId: tenant.id,
      userId: member.id,
      role: "member",
    });

    const updated = await withTenantContext(tenant.id, (tx) =>
      changeMemberRole(tx, { membershipId: membership.id, newRole: "owner", actingRole: "owner" }),
    );

    expect(updated.role).toBe("owner");
  });

  it("refuses to demote the tenant's only OWNER", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    const ownerMembership = await createMembership({
      tenantId: tenant.id,
      userId: owner.id,
      role: "owner",
    });

    await expect(
      withTenantContext(tenant.id, (tx) =>
        changeMemberRole(tx, {
          membershipId: ownerMembership.id,
          newRole: "admin",
          actingRole: "owner",
        }),
      ),
    ).rejects.toThrow(LastOwnerError);
  });

  it("allows demoting an OWNER when another OWNER remains", async () => {
    const tenant = await createTenant();
    const ownerA = await createUser();
    const ownerAMembership = await createMembership({
      tenantId: tenant.id,
      userId: ownerA.id,
      role: "owner",
    });
    const ownerB = await createUser();
    await createMembership({ tenantId: tenant.id, userId: ownerB.id, role: "owner" });

    const updated = await withTenantContext(tenant.id, (tx) =>
      changeMemberRole(tx, {
        membershipId: ownerAMembership.id,
        newRole: "admin",
        actingRole: "owner",
      }),
    );

    expect(updated.role).toBe("admin");
  });

  it("throws MembershipNotFoundError for a membership id outside the current tenant", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const user = await createUser();
    const membershipInB = await createMembership({ tenantId: tenantB.id, userId: user.id });

    await expect(
      withTenantContext(tenantA.id, (tx) =>
        changeMemberRole(tx, {
          membershipId: membershipInB.id,
          newRole: "admin",
          actingRole: "owner",
        }),
      ),
    ).rejects.toThrow(MembershipNotFoundError);
  });

  it("race safety: two concurrent attempts to demote both of a tenant's two OWNERs — exactly one must fail", async () => {
    const tenant = await createTenant();
    const ownerA = await createUser();
    const ownerAMembership = await createMembership({
      tenantId: tenant.id,
      userId: ownerA.id,
      role: "owner",
    });
    const ownerB = await createUser();
    const ownerBMembership = await createMembership({
      tenantId: tenant.id,
      userId: ownerB.id,
      role: "owner",
    });

    const results = await Promise.allSettled([
      withTenantContext(tenant.id, (tx) =>
        changeMemberRole(tx, {
          membershipId: ownerAMembership.id,
          newRole: "admin",
          actingRole: "owner",
        }),
      ),
      withTenantContext(tenant.id, (tx) =>
        changeMemberRole(tx, {
          membershipId: ownerBMembership.id,
          newRole: "admin",
          actingRole: "owner",
        }),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(LastOwnerError);

    const remainingOwners = (await withTenantContext(tenant.id, (tx) => listMembers(tx))).filter(
      (m) => m.role === "owner",
    );
    expect(remainingOwners).toHaveLength(1);
  });
});

describe("removeMember", () => {
  it("refuses to remove the tenant's only OWNER", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    const ownerMembership = await createMembership({
      tenantId: tenant.id,
      userId: owner.id,
      role: "owner",
    });

    await expect(
      withTenantContext(tenant.id, (tx) => removeMember(tx, { membershipId: ownerMembership.id })),
    ).rejects.toThrow(LastOwnerError);
  });

  it("allows removing a non-owner member", async () => {
    const tenant = await createTenant();
    const owner = await createUser();
    await createMembership({ tenantId: tenant.id, userId: owner.id, role: "owner" });
    const member = await createUser();
    const membership = await createMembership({ tenantId: tenant.id, userId: member.id });

    await withTenantContext(tenant.id, (tx) => removeMember(tx, { membershipId: membership.id }));

    const remaining = await withTenantContext(tenant.id, (tx) => listMembers(tx));
    expect(remaining.map((m) => m.userId)).not.toContain(member.id);
  });

  it("allows removing an OWNER when another OWNER remains", async () => {
    const tenant = await createTenant();
    const ownerA = await createUser();
    const ownerAMembership = await createMembership({
      tenantId: tenant.id,
      userId: ownerA.id,
      role: "owner",
    });
    const ownerB = await createUser();
    await createMembership({ tenantId: tenant.id, userId: ownerB.id, role: "owner" });

    await withTenantContext(tenant.id, (tx) =>
      removeMember(tx, { membershipId: ownerAMembership.id }),
    );

    const remaining = await withTenantContext(tenant.id, (tx) => listMembers(tx));
    expect(remaining.map((m) => m.userId)).not.toContain(ownerA.id);
  });
});

describe("listMembers", () => {
  it("only lists members of the current tenant", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const userA = await createUser();
    const userB = await createUser();
    await createMembership({ tenantId: tenantA.id, userId: userA.id });
    await createMembership({ tenantId: tenantB.id, userId: userB.id });

    const membersOfA = await withTenantContext(tenantA.id, (tx) => listMembers(tx));

    expect(membersOfA.map((m) => m.userId)).toEqual([userA.id]);
  });
});
