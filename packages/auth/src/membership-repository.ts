import { and, eq } from "drizzle-orm";
import type { AppTx, MembershipRole } from "@provence360/database";
import { memberships, users } from "@provence360/database";
import { recordAuditLog } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import { AuthorizationError, LastOwnerError, MembershipNotFoundError } from "./errors";

// Tenant-scoped membership management — the mutation side of
// membership-lookup.ts's read side. Runs through `provence360_app` inside
// `withTenantContext`, exactly like packages/sites and packages/domains:
// `tenantId` is always derived from the active context, never accepted as
// a parameter. Permission checks (member.invite/update/remove) are the
// caller's job (withAuthorizedTenantContext) — this module enforces only
// the one invariant that no permission check can express: a tenant may
// never end up with zero OWNERs.

export interface MemberRow {
  membershipId: string;
  role: MembershipRole;
  userId: string;
  email: string;
  name: string | null;
}

export async function listMembers(tx: AppTx): Promise<MemberRow[]> {
  const tenantId = requireCurrentTenantId();
  return tx
    .select({
      membershipId: memberships.id,
      role: memberships.role,
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId));
}

export async function addMember(
  tx: AppTx,
  input: { userId: string; role: MembershipRole; actingRole: MembershipRole; actorUserId?: string },
) {
  assertCanGrantRole(input.role, input.actingRole);
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .insert(memberships)
    .values({ tenantId, userId: input.userId, role: input.role })
    .returning();
  if (!row) throw new Error("Failed to add member");

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "MEMBER_CREATED",
    targetType: "membership",
    targetId: row.id,
    metadata: { userId: row.userId, role: row.role },
  });

  return row;
}

export async function changeMemberRole(
  tx: AppTx,
  input: {
    membershipId: string;
    newRole: MembershipRole;
    actingRole: MembershipRole;
    actorUserId?: string;
  },
) {
  assertCanGrantRole(input.newRole, input.actingRole);
  const tenantId = requireCurrentTenantId();
  const current = await getOwnMembership(tx, tenantId, input.membershipId);

  if (current.role === "owner" && input.newRole !== "owner") {
    await assertNotLastOwner(tx, tenantId);
  }

  const [updated] = await tx
    .update(memberships)
    .set({ role: input.newRole })
    .where(eq(memberships.id, input.membershipId))
    .returning();
  if (!updated) throw new Error("Failed to update member role");

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "MEMBER_ROLE_CHANGED",
    targetType: "membership",
    targetId: updated.id,
    metadata: { userId: updated.userId, from: current.role, to: updated.role },
  });

  return updated;
}

export async function removeMember(
  tx: AppTx,
  input: { membershipId: string; actorUserId?: string },
): Promise<void> {
  const tenantId = requireCurrentTenantId();
  const current = await getOwnMembership(tx, tenantId, input.membershipId);

  if (current.role === "owner") {
    await assertNotLastOwner(tx, tenantId);
  }

  await tx.delete(memberships).where(eq(memberships.id, input.membershipId));

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "MEMBER_REMOVED",
    targetType: "membership",
    targetId: current.id,
    metadata: { userId: current.userId, role: current.role },
  });
}

/**
 * "ADMIN → ... pas de transfert ownership" (section 8): granting the
 * OWNER role — whether adding a new member as owner or promoting an
 * existing one — is itself an ownership-adjacent action that `member.update`
 * / `member.invite` alone don't cover. Only an existing OWNER may do it.
 */
function assertCanGrantRole(targetRole: MembershipRole, actingRole: MembershipRole): void {
  if (targetRole === "owner" && actingRole !== "owner") {
    throw new AuthorizationError("Only an OWNER can grant the OWNER role.");
  }
}

async function getOwnMembership(tx: AppTx, tenantId: string, membershipId: string) {
  const [row] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, tenantId)));
  if (!row) throw new MembershipNotFoundError(membershipId);
  return row;
}

/**
 * Locks every OWNER membership row for the tenant (`SELECT ... FOR UPDATE`)
 * and throws if there's only one — i.e. if the caller is about to demote
 * or remove it. The lock is what makes this safe under concurrency: two
 * requests racing to demote the tenant's last two owners serialize on
 * these rows, so the second one always re-checks against the *post-first-
 * commit* count rather than a stale snapshot. See
 * docs/AUTHORIZATION.md#owner-invariant and the concurrency test in
 * membership-repository.test.ts.
 */
async function assertNotLastOwner(tx: AppTx, tenantId: string): Promise<void> {
  const ownerRows = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "owner")))
    .for("update");

  if (ownerRows.length <= 1) {
    throw new LastOwnerError();
  }
}
