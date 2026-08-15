import { listMembers } from "@provence360/auth";
import { withTenantPage } from "@/lib/actor";
import { AddMemberForm, ChangeRoleForm, RemoveMemberForm } from "./member-actions-client";

export const dynamic = "force-dynamic";

export default async function MembersPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  const { memberList, canInvite, canUpdate, canRemove } = await withTenantPage(
    tenantId,
    "member.read",
    async (tx, actor) => ({
      memberList: await listMembers(tx),
      canInvite: actor.permissions.has("member.invite"),
      canUpdate: actor.permissions.has("member.update"),
      canRemove: actor.permissions.has("member.remove"),
    }),
  );

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Members</h1>
      {canInvite ? <AddMemberForm tenantId={tenantId} /> : null}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
            <th style={{ padding: "6px 4px" }}>Name</th>
            <th style={{ padding: "6px 4px" }}>Email</th>
            <th style={{ padding: "6px 4px" }}>Role</th>
            {canUpdate || canRemove ? <th style={{ padding: "6px 4px" }}></th> : null}
          </tr>
        </thead>
        <tbody>
          {memberList.map((member) => (
            <tr key={member.membershipId} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: "6px 4px" }}>{member.name ?? "—"}</td>
              <td style={{ padding: "6px 4px", color: "#6b7280" }}>{member.email}</td>
              <td style={{ padding: "6px 4px" }}>
                {canUpdate ? (
                  <ChangeRoleForm
                    tenantId={tenantId}
                    membershipId={member.membershipId}
                    currentRole={member.role}
                  />
                ) : (
                  member.role
                )}
              </td>
              {canUpdate || canRemove ? (
                <td style={{ padding: "6px 4px" }}>
                  {canRemove ? (
                    <RemoveMemberForm tenantId={tenantId} membershipId={member.membershipId} />
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
