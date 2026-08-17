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
    internalName: string;
    publicName: string;
    propertyType: string;
    addressLine1: string | null;
    addressLine2: string | null;
    addressCity: string | null;
    addressPostalCode: string | null;
    addressRegion: string | null;
    addressCountry: string | null;
    latitude: string | null;
    longitude: string | null;
    timezone: string | null;
    description: string | null;
    status: string;
    checkInTime: string | null;
    checkOutTime: string | null;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    smokingPolicy: string | null;
    petsPolicy: string | null;
    eventsPolicy: string | null;
    locationDisclosure: string;
  };
}) {
  const [state, formAction, isPending] = useActionState(
    updatePropertyAction.bind(null, tenantId, siteId, propertyId),
    initialState,
  );

  // Postgres `time` round-trips as "HH:MM:SS" — the `<input type="time">`
  // control only accepts "HH:MM", and the form itself only ever submits
  // "HH:MM" (see actions.ts's `timeOfDaySchema`), so trim here.
  const asTimeInputValue = (v: string | null) => (v ? v.slice(0, 5) : "");

  return (
    <form action={formAction} style={{ display: "grid", gap: 10, maxWidth: 480, marginBottom: 24 }}>
      <label style={labelStyle}>
        Internal name
        <input name="internalName" defaultValue={property.internalName} style={inputStyle} />
      </label>
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

      <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
        <legend style={{ fontSize: 12, color: "#6b7280" }}>Address</legend>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={labelStyle}>
            Line 1
            <input
              name="addressLine1"
              defaultValue={property.addressLine1 ?? ""}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Line 2
            <input
              name="addressLine2"
              defaultValue={property.addressLine2 ?? ""}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            City
            <input
              name="addressCity"
              defaultValue={property.addressCity ?? ""}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Postal code
            <input
              name="addressPostalCode"
              defaultValue={property.addressPostalCode ?? ""}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Region
            <input
              name="addressRegion"
              defaultValue={property.addressRegion ?? ""}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Country (ISO-2)
            <input
              name="addressCountry"
              maxLength={2}
              defaultValue={property.addressCountry ?? ""}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Latitude
            <input
              name="latitude"
              type="number"
              step="any"
              defaultValue={property.latitude ?? ""}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Longitude
            <input
              name="longitude"
              type="number"
              step="any"
              defaultValue={property.longitude ?? ""}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Timezone (IANA)
            <input name="timezone" defaultValue={property.timezone ?? ""} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Location disclosure to guests
            <select
              name="locationDisclosure"
              defaultValue={property.locationDisclosure}
              style={inputStyle}
            >
              <option value="exact">Exact — full address shown</option>
              <option value="approximate">Approximate — city/region only</option>
              <option value="hidden">Hidden — no location shown</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
        <legend style={{ fontSize: 12, color: "#6b7280" }}>Guest experience</legend>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={labelStyle}>
            Check-in
            <input
              name="checkInTime"
              type="time"
              defaultValue={asTimeInputValue(property.checkInTime)}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Check-out
            <input
              name="checkOutTime"
              type="time"
              defaultValue={asTimeInputValue(property.checkOutTime)}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Quiet hours — start
            <input
              name="quietHoursStart"
              type="time"
              defaultValue={asTimeInputValue(property.quietHoursStart)}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Quiet hours — end
            <input
              name="quietHoursEnd"
              type="time"
              defaultValue={asTimeInputValue(property.quietHoursEnd)}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Smoking
            <select
              name="smokingPolicy"
              defaultValue={property.smokingPolicy ?? ""}
              style={inputStyle}
            >
              <option value="">Not specified</option>
              <option value="allowed">Allowed</option>
              <option value="not_allowed">Not allowed</option>
              <option value="on_request">On request</option>
            </select>
          </label>
          <label style={labelStyle}>
            Pets
            <select name="petsPolicy" defaultValue={property.petsPolicy ?? ""} style={inputStyle}>
              <option value="">Not specified</option>
              <option value="allowed">Allowed</option>
              <option value="not_allowed">Not allowed</option>
              <option value="on_request">On request</option>
            </select>
          </label>
          <label style={labelStyle}>
            Parties / events
            <select
              name="eventsPolicy"
              defaultValue={property.eventsPolicy ?? ""}
              style={inputStyle}
            >
              <option value="">Not specified</option>
              <option value="allowed">Allowed</option>
              <option value="not_allowed">Not allowed</option>
              <option value="on_request">On request</option>
            </select>
          </label>
        </div>
      </fieldset>

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
