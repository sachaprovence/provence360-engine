"use client";

import { useActionState } from "react";
import { publishSiteAction, rollbackSiteAction, type PublishingActionState } from "./actions";

const initialState: PublishingActionState = {};
const buttonStyle = {
  padding: "7px 12px",
  borderRadius: 6,
  border: "none",
  background: "#111827",
  color: "white",
  fontSize: 13,
  cursor: "pointer",
};

export function PublishForm({ tenantId, siteId }: { tenantId: string; siteId: string }) {
  const [state, formAction, isPending] = useActionState(
    publishSiteAction.bind(null, tenantId, siteId),
    initialState,
  );

  return (
    <form action={formAction} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button type="submit" disabled={isPending} style={buttonStyle}>
        {isPending ? "Publishing…" : "Publish"}
      </button>
      {state.error ? (
        <span role="alert" style={{ color: "#b91c1c", fontSize: 12 }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function RollbackForm({
  tenantId,
  siteId,
  targetRevisionId,
  targetRevisionNumber,
}: {
  tenantId: string;
  siteId: string;
  targetRevisionId: string;
  targetRevisionNumber: number;
}) {
  const [state, formAction, isPending] = useActionState(
    rollbackSiteAction.bind(null, tenantId, siteId),
    initialState,
  );

  return (
    <form action={formAction} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input type="hidden" name="targetRevisionId" value={targetRevisionId} />
      <button
        type="submit"
        disabled={isPending}
        style={{
          ...buttonStyle,
          padding: "4px 8px",
          background: "white",
          color: "#111827",
          border: "1px solid #d1d5db",
        }}
      >
        {isPending ? "Rolling back…" : `Roll back to #${targetRevisionNumber}`}
      </button>
      {state.error ? (
        <span role="alert" style={{ color: "#b91c1c", fontSize: 12 }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
