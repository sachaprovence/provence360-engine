"use client";

import { useActionState } from "react";
import {
  addMemberAction,
  changeMemberRoleAction,
  removeMemberAction,
  type MemberActionState,
} from "./actions";

const initialState: MemberActionState = {};
const inputStyle = { padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6 };
const buttonStyle = {
  padding: "7px 12px",
  borderRadius: 6,
  border: "none",
  background: "#111827",
  color: "white",
  fontSize: 13,
  cursor: "pointer",
};

export function AddMemberForm({ tenantId }: { tenantId: string }) {
  const [state, formAction, isPending] = useActionState(
    addMemberAction.bind(null, tenantId),
    initialState,
  );

  return (
    <form
      action={formAction}
      style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 20 }}
    >
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        Email
        <input name="email" type="email" required style={inputStyle} />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        Role
        <select name="role" defaultValue="member" style={inputStyle}>
          <option value="member">member</option>
          <option value="admin">admin</option>
          <option value="owner">owner</option>
        </select>
      </label>
      <button type="submit" disabled={isPending} style={buttonStyle}>
        {isPending ? "Adding…" : "Add member"}
      </button>
      {state.error ? (
        <span role="alert" style={{ color: "#b91c1c", fontSize: 13 }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function ChangeRoleForm({
  tenantId,
  membershipId,
  currentRole,
}: {
  tenantId: string;
  membershipId: string;
  currentRole: string;
}) {
  const [state, formAction, isPending] = useActionState(
    changeMemberRoleAction.bind(null, tenantId),
    initialState,
  );

  return (
    <form action={formAction} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input type="hidden" name="membershipId" value={membershipId} />
      <select
        name="newRole"
        defaultValue={currentRole}
        style={{ ...inputStyle, padding: "4px 6px" }}
      >
        <option value="member">member</option>
        <option value="admin">admin</option>
        <option value="owner">owner</option>
      </select>
      <button type="submit" disabled={isPending} style={{ ...buttonStyle, padding: "4px 8px" }}>
        Save
      </button>
      {state.error ? (
        <span role="alert" style={{ color: "#b91c1c", fontSize: 12 }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function RemoveMemberForm({
  tenantId,
  membershipId,
}: {
  tenantId: string;
  membershipId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    removeMemberAction.bind(null, tenantId),
    initialState,
  );

  return (
    <form action={formAction} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input type="hidden" name="membershipId" value={membershipId} />
      <button
        type="submit"
        disabled={isPending}
        style={{
          ...buttonStyle,
          background: "white",
          color: "#b91c1c",
          border: "1px solid #fca5a5",
        }}
      >
        Remove
      </button>
      {state.error ? (
        <span role="alert" style={{ color: "#b91c1c", fontSize: 12 }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
