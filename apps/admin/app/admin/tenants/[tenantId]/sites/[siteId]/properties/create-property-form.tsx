"use client";

import { useActionState } from "react";
import { buttonStyle, errorTextStyle, inputStyle, labelStyle } from "@/lib/form-styles";
import { createPropertyAction, type FormActionState } from "./actions";

const initialState: FormActionState = {};

export function CreatePropertyForm({ tenantId, siteId }: { tenantId: string; siteId: string }) {
  const [state, formAction, isPending] = useActionState(
    createPropertyAction.bind(null, tenantId, siteId),
    initialState,
  );

  return (
    <form
      action={formAction}
      style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 20 }}
    >
      <label style={labelStyle}>
        Public name
        <input name="publicName" required style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Type
        <select name="propertyType" defaultValue="villa" style={inputStyle}>
          <option value="villa">villa</option>
          <option value="house">house</option>
          <option value="gite">gite</option>
          <option value="domaine">domaine</option>
          <option value="guest_house">guest_house</option>
          <option value="apartment">apartment</option>
          <option value="other">other</option>
        </select>
      </label>
      <label style={labelStyle}>
        City
        <input name="addressCity" style={inputStyle} />
      </label>
      <button type="submit" disabled={isPending} style={buttonStyle}>
        {isPending ? "Creating…" : "Create property"}
      </button>
      {state.error ? (
        <span role="alert" style={errorTextStyle}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
