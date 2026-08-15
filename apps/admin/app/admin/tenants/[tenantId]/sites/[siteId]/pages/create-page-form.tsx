"use client";

import { useActionState } from "react";
import { buttonStyle, errorTextStyle, inputStyle, labelStyle } from "@/lib/form-styles";
import { createPageAction, type FormActionState } from "./actions";

const initialState: FormActionState = {};

export function CreatePageForm({ tenantId, siteId }: { tenantId: string; siteId: string }) {
  const [state, formAction, isPending] = useActionState(
    createPageAction.bind(null, tenantId, siteId),
    initialState,
  );

  return (
    <form
      action={formAction}
      style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 20 }}
    >
      <label style={labelStyle}>
        Internal name
        <input name="internalName" required style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Slug (ignored for &quot;home&quot;)
        <input name="slug" placeholder="about-us" style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Type
        <select name="pageType" defaultValue="standard" style={inputStyle}>
          <option value="home">home</option>
          <option value="standard">standard</option>
          <option value="property">property</option>
          <option value="unit">unit</option>
          <option value="contact">contact</option>
        </select>
      </label>
      <button type="submit" disabled={isPending} style={buttonStyle}>
        {isPending ? "Creating…" : "Create page"}
      </button>
      {state.error ? (
        <span role="alert" style={errorTextStyle}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
