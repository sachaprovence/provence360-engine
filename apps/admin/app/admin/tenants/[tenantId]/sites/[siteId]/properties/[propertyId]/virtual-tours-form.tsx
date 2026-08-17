"use client";

import { useRouter } from "next/navigation";
import { useActionState, useTransition } from "react";
import {
  buttonStyle,
  dangerButtonStyle,
  errorTextStyle,
  inputStyle,
  labelStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from "@/lib/form-styles";
import {
  createVirtualTourAction,
  deleteVirtualTourAction,
  updateVirtualTourStatusAction,
  type FormActionState,
} from "../actions";

const initialState: FormActionState = {};

// Admin CRUD surface for VirtualTours on a Property (v0.7, section 27 of
// the brief) — same "table of existing rows + create form below" pattern
// as SleepingArrangementsForm. Status changes go through a plain
// `<select onChange>` (not a form submit), the same shape as
// PropertyAmenitiesForm's live toggles: there is no "save" step to
// forget, and switching a Tour to `archived` here takes effect on the
// public site immediately (RenderContext reads VirtualTour rows live,
// never from a frozen manifest — see docs/adr/0019-virtual-tour-immersive-kernel.md).
export function VirtualToursForm({
  tenantId,
  siteId,
  propertyId,
  tours,
  units,
}: {
  tenantId: string;
  siteId: string;
  propertyId: string;
  tours: ReadonlyArray<{
    id: string;
    internalName: string;
    publicName: string;
    provider: string;
    unitId: string | null;
    status: string;
  }>;
  units: ReadonlyArray<{ id: string; publicName: string }>;
}) {
  const [state, formAction, isPending] = useActionState(
    createVirtualTourAction.bind(null, tenantId, siteId, propertyId),
    initialState,
  );
  const router = useRouter();
  const [isMutating, startMutation] = useTransition();

  const unitName = (unitId: string | null) =>
    unitId ? (units.find((u) => u.id === unitId)?.publicName ?? "—") : "Property-level";

  function setStatus(tourId: string, status: string) {
    startMutation(async () => {
      await updateVirtualTourStatusAction(tenantId, siteId, propertyId, tourId, status);
      router.refresh();
    });
  }

  function remove(tourId: string) {
    startMutation(async () => {
      await deleteVirtualTourAction(tenantId, siteId, propertyId, tourId);
      router.refresh();
    });
  }

  return (
    <div style={{ maxWidth: 720 }}>
      {tours.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>No virtual tours yet.</p>
      ) : (
        <table style={{ ...tableStyle, marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Provider</th>
              <th style={thStyle}>Scope</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {tours.map((tour) => (
              <tr key={tour.id}>
                <td style={tdStyle}>{tour.publicName}</td>
                <td style={tdStyle}>{tour.provider}</td>
                <td style={tdStyle}>{unitName(tour.unitId)}</td>
                <td style={tdStyle}>
                  <select
                    value={tour.status}
                    disabled={isMutating}
                    onChange={(e) => {
                      setStatus(tour.id, e.target.value);
                    }}
                    style={inputStyle}
                  >
                    <option value="draft">draft</option>
                    <option value="active">active</option>
                    <option value="archived">archived</option>
                  </select>
                </td>
                <td style={tdStyle}>
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => {
                      remove(tour.id);
                    }}
                    style={dangerButtonStyle}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form action={formAction} style={{ display: "grid", gap: 10, maxWidth: 480 }}>
        <input type="hidden" name="provider" value="matterport" />
        <label style={labelStyle}>
          Internal name
          <input name="internalName" required style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Public name
          <input name="publicName" required style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Matterport share URL or Model SID
          <input
            name="rawProviderInput"
            required
            placeholder="https://my.matterport.com/show/?m=..."
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Scope
          <select name="unitId" defaultValue="" style={inputStyle}>
            <option value="">Property-level (whole property)</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.publicName}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button type="submit" disabled={isPending} style={buttonStyle}>
            {isPending ? "Adding…" : "Add virtual tour"}
          </button>
        </div>
      </form>
      {state.error ? (
        <span role="alert" style={errorTextStyle}>
          {state.error}
        </span>
      ) : null}
    </div>
  );
}
