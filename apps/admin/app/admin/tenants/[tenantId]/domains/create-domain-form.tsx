"use client";

import { useActionState } from "react";
import { createDomainAction, type CreateDomainState } from "./actions";

const initialState: CreateDomainState = {};

export function CreateDomainForm({
  tenantId,
  sites,
}: {
  tenantId: string;
  sites: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, isPending] = useActionState(
    createDomainAction.bind(null, tenantId),
    initialState,
  );

  return (
    <form
      action={formAction}
      style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 20 }}
    >
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        Site
        <select name="siteId" required style={inputStyle}>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        Hostname
        <input name="hostname" required placeholder="example.com" style={inputStyle} />
      </label>
      <button type="submit" disabled={isPending} style={buttonStyle}>
        {isPending ? "Adding…" : "Add domain"}
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
