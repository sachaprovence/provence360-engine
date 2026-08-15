"use client";

import { useActionState } from "react";
import { buttonStyle, errorTextStyle, inputStyle, labelStyle } from "@/lib/form-styles";
import { updatePropertyAction, type FormActionState } from "../actions";

const initialState: FormActionState = {};

export function PropertyEditForm({
  tenantId,
  siteId,
  propertyId,
  property,
}: {
  tenantId: string;
  siteId: string;
  propertyId: string;
  property: {
    publicName: string;
    propertyType: string;
    addressCity: string | null;
    description: string | null;
    status: string;
  };
}) {
  const [state, formAction, isPending] = useActionState(
    updatePropertyAction.bind(null, tenantId, siteId, propertyId),
    initialState,
  );

  return (
    <form action={formAction} style={{ display: "grid", gap: 10, maxWidth: 420, marginBottom: 24 }}>
      <label style={labelStyle}>
        Public name
        <input name="publicName" defaultValue={property.publicName} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Type
        <select name="propertyType" defaultValue={property.propertyType} style={inputStyle}>
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
        <input name="addressCity" defaultValue={property.addressCity ?? ""} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Description
        <textarea
          name="description"
          defaultValue={property.description ?? ""}
          style={{ ...inputStyle, minHeight: 80 }}
        />
      </label>
      <label style={labelStyle}>
        Status
        <select name="status" defaultValue={property.status} style={inputStyle}>
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
        </select>
      </label>
      <div>
        <button type="submit" disabled={isPending} style={buttonStyle}>
          {isPending ? "Saving…" : "Save property"}
        </button>
      </div>
      {state.error ? (
        <span role="alert" style={errorTextStyle}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
