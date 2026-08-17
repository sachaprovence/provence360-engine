"use client";

import { useActionState } from "react";
import { buttonStyle, errorTextStyle, inputStyle, labelStyle } from "@/lib/form-styles";
import { updateUnitAction, type FormActionState } from "../../../actions";

const initialState: FormActionState = {};

export function UnitEditForm({
  tenantId,
  siteId,
  propertyId,
  unitId,
  unit,
}: {
  tenantId: string;
  siteId: string;
  propertyId: string;
  unitId: string;
  unit: {
    internalName: string;
    publicName: string;
    maxGuests: number | null;
    bedrooms: number | null;
    beds: number | null;
    bathrooms: string | null;
    size: string | null;
    sizeUnit: string | null;
    description: string | null;
    status: string;
  };
}) {
  const [state, formAction, isPending] = useActionState(
    updateUnitAction.bind(null, tenantId, siteId, propertyId, unitId),
    initialState,
  );

  return (
    <form action={formAction} style={{ display: "grid", gap: 10, maxWidth: 420, marginBottom: 24 }}>
      <label style={labelStyle}>
        Internal name
        <input name="internalName" defaultValue={unit.internalName} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Public name
        <input name="publicName" defaultValue={unit.publicName} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Max guests
        <input
          name="maxGuests"
          type="number"
          min={1}
          defaultValue={unit.maxGuests ?? ""}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Bedrooms
        <input
          name="bedrooms"
          type="number"
          min={0}
          defaultValue={unit.bedrooms ?? ""}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Beds (fallback aggregate — used only when no sleeping arrangement detail rows exist below)
        <input
          name="beds"
          type="number"
          min={0}
          defaultValue={unit.beds ?? ""}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Bathrooms
        <input
          name="bathrooms"
          type="number"
          min={0}
          step={0.5}
          defaultValue={unit.bathrooms ?? ""}
          style={inputStyle}
        />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ ...labelStyle, flex: 1 }}>
          Size
          <input
            name="size"
            type="number"
            min={0}
            step="any"
            defaultValue={unit.size ?? ""}
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, flex: 1 }}>
          Size unit
          <select name="sizeUnit" defaultValue={unit.sizeUnit ?? ""} style={inputStyle}>
            <option value="">—</option>
            <option value="sqm">sqm</option>
            <option value="sqft">sqft</option>
          </select>
        </label>
      </div>
      <label style={labelStyle}>
        Description
        <textarea
          name="description"
          defaultValue={unit.description ?? ""}
          style={{ ...inputStyle, minHeight: 80 }}
        />
      </label>
      <label style={labelStyle}>
        Status
        <select name="status" defaultValue={unit.status} style={inputStyle}>
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
          <option value="not_bookable_separately">not_bookable_separately</option>
        </select>
      </label>
      <div>
        <button type="submit" disabled={isPending} style={buttonStyle}>
          {isPending ? "Saving…" : "Save unit"}
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
