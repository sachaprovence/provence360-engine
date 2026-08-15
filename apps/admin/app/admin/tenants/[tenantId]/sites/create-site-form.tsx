"use client";

import { useActionState } from "react";
import { createSiteAction, type CreateSiteState } from "./actions";

const initialState: CreateSiteState = {};

export function CreateSiteForm({ tenantId }: { tenantId: string }) {
  const [state, formAction, isPending] = useActionState(
    createSiteAction.bind(null, tenantId),
    initialState,
  );

  return (
    <form
      action={formAction}
      style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 20 }}
    >
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        Name
        <input name="name" required style={inputStyle} />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        Slug
        <input name="slug" required pattern="[a-z0-9-]+" style={inputStyle} />
      </label>
      <button type="submit" disabled={isPending} style={buttonStyle}>
        {isPending ? "Creating…" : "Create site"}
      </button>
      {state.error ? (
        <span role="alert" style={{ color: "#b91c1c", fontSize: 13 }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

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
