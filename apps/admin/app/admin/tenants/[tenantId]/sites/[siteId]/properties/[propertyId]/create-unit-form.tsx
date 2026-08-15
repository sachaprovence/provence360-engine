"use client";

import { useActionState } from "react";
import { buttonStyle, errorTextStyle, inputStyle, labelStyle } from "@/lib/form-styles";
import { createUnitAction, type FormActionState } from "../actions";

const initialState: FormActionState = {};

export function CreateUnitForm({
  tenantId,
  siteId,
  propertyId,
}: {
  tenantId: string;
  siteId: string;
  propertyId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    createUnitAction.bind(null, tenantId, siteId, propertyId),
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
        Max guests
        <input name="maxGuests" type="number" min={1} style={{ ...inputStyle, width: 80 }} />
      </label>
      <label style={labelStyle}>
        Bedrooms
        <input name="bedrooms" type="number" min={0} style={{ ...inputStyle, width: 80 }} />
      </label>
      <label style={labelStyle}>
        Ordering
        <input
          name="ordering"
          type="number"
          min={0}
          defaultValue={0}
          style={{ ...inputStyle, width: 80 }}
        />
      </label>
      <button type="submit" disabled={isPending} style={buttonStyle}>
        {isPending ? "Creating…" : "Create unit"}
      </button>
      {state.error ? (
        <span role="alert" style={errorTextStyle}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
