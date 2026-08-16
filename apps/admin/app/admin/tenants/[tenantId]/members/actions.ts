"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addMember,
  changeMemberRole,
  findUserByEmail,
  membershipRoleValues,
  removeMember,
} from "@provence360/auth";
import { uuidSchema } from "@provence360/validation";
import { withTenantPage } from "@/lib/actor";

export interface MemberActionState {
  error?: string;
}

class NoSuchAccountError extends Error {
  constructor() {
    super("No account exists with that email yet.");
    this.name = "NoSuchAccountError";
  }
}

const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(255),
  role: z.enum(membershipRoleValues),
});

export async function addMemberAction(
  tenantId: string,
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const parsed = addMemberSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: "Enter a valid email and role." };

  try {
    await withTenantPage(tenantId, "member.invite", async (tx, actor) => {
      // The email lookup happens *inside* the permission-checked callback,
      // deliberately — this is a Server Action, directly POST-able with
      // any tenantId/email regardless of what the rendered page shows.
      // Doing this lookup before withTenantPage's check would let anyone
      // authenticated (any user, any tenant, any role) probe arbitrary
      // emails against arbitrary tenant ids and learn which addresses
      // have accounts, entirely outside the member.invite permission this
      // action is supposed to require.
      const user = await findUserByEmail(parsed.data.email);
      if (!user) throw new NoSuchAccountError();

      return addMember(tx, {
        userId: user.id,
        role: parsed.data.role,
        actingRole: actor.role,
        actorUserId: actor.userId,
      });
    });
  } catch (error) {
    return { error: friendlyMessage(error) };
  }

  revalidatePath(`/admin/tenants/${tenantId}/members`);
  return {};
}

const changeRoleSchema = z.object({
  membershipId: uuidSchema,
  newRole: z.enum(membershipRoleValues),
});

export async function changeMemberRoleAction(
  tenantId: string,
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const parsed = changeRoleSchema.safeParse({
    membershipId: formData.get("membershipId"),
    newRole: formData.get("newRole"),
  });
  if (!parsed.success) return { error: "Invalid input." };

  try {
    await withTenantPage(tenantId, "member.update", (tx, actor) =>
      changeMemberRole(tx, {
        membershipId: parsed.data.membershipId,
        newRole: parsed.data.newRole,
        actingRole: actor.role,
        actorUserId: actor.userId,
      }),
    );
  } catch (error) {
    return { error: friendlyMessage(error) };
  }

  revalidatePath(`/admin/tenants/${tenantId}/members`);
  return {};
}

const removeMemberSchema = z.object({ membershipId: uuidSchema });

export async function removeMemberAction(
  tenantId: string,
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const parsed = removeMemberSchema.safeParse({ membershipId: formData.get("membershipId") });
  if (!parsed.success) return { error: "Invalid input." };

  try {
    await withTenantPage(tenantId, "member.remove", (tx, actor) =>
      removeMember(tx, { membershipId: parsed.data.membershipId, actorUserId: actor.userId }),
    );
  } catch (error) {
    return { error: friendlyMessage(error) };
  }

  revalidatePath(`/admin/tenants/${tenantId}/members`);
  return {};
}

function friendlyMessage(error: unknown): string {
  if (
    error instanceof Error &&
    /LastOwnerError|AuthorizationError|MembershipNotFoundError|NoSuchAccountError/.test(error.name)
  ) {
    return error.message;
  }
  if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
    return "That person is already a member of this tenant.";
  }
  throw error;
}
