"use client";

import { useActionState } from "react";
import { buttonStyle, errorTextStyle, inputStyle, labelStyle } from "@/lib/form-styles";
import { updatePageMetaAction, type FormActionState } from "../actions";

const initialState: FormActionState = {};

export function PageMetaForm({
  tenantId,
  siteId,
  pageId,
  page,
}: {
  tenantId: string;
  siteId: string;
  pageId: string;
  page: { internalName: string; status: string };
}) {
  const [state, formAction, isPending] = useActionState(
    updatePageMetaAction.bind(null, tenantId, siteId, pageId),
    initialState,
  );

  return (
    <form
      action={formAction}
      style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 20 }}
    >
      <label style={labelStyle}>
        Internal name
        <input name="internalName" defaultValue={page.internalName} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Status
        <select name="status" defaultValue={page.status} style={inputStyle}>
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
        </select>
      </label>
      <button type="submit" disabled={isPending} style={buttonStyle}>
        {isPending ? "Saving…" : "Save"}
      </button>
      {state.error ? (
        <span role="alert" style={errorTextStyle}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
