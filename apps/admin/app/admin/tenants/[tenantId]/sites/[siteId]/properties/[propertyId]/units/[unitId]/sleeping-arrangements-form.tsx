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
  createSleepingArrangementAction,
  deleteSleepingArrangementAction,
  type FormActionState,
} from "../../../actions";

const initialState: FormActionState = {};

const bedTypes = [
  "single",
  "double",
  "queen",
  "king",
  "bunk",
  "sofa_bed",
  "floor_mattress",
  "crib",
  "other",
];

export function SleepingArrangementsForm({
  tenantId,
  siteId,
  propertyId,
  unitId,
  arrangements,
}: {
  tenantId: string;
  siteId: string;
  propertyId: string;
  unitId: string;
  arrangements: ReadonlyArray<{
    id: string;
    roomLabel: string | null;
    bedType: string;
    quantity: number;
    ordering: number;
  }>;
}) {
  const [state, formAction, isPending] = useActionState(
    createSleepingArrangementAction.bind(null, tenantId, siteId, propertyId, unitId),
    initialState,
  );
  const router = useRouter();
  const [isDeleting, startDelete] = useTransition();

  function remove(id: string) {
    startDelete(async () => {
      await deleteSleepingArrangementAction(tenantId, siteId, propertyId, unitId, id);
      router.refresh();
    });
  }

  return (
    <div style={{ maxWidth: 560 }}>
      {arrangements.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>
          No sleeping-arrangement detail yet — the Unit&apos;s raw &quot;beds&quot; count is used as
          the guest-facing total instead.
        </p>
      ) : (
        <table style={{ ...tableStyle, marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>Room</th>
              <th style={thStyle}>Bed type</th>
              <th style={thStyle}>Qty</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {arrangements.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}>{row.roomLabel ?? "—"}</td>
                <td style={tdStyle}>{row.bedType}</td>
                <td style={tdStyle}>{row.quantity}</td>
                <td style={tdStyle}>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => {
                      remove(row.id);
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

      <form action={formAction} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <label style={labelStyle}>
          Room label
          <input name="roomLabel" placeholder="Bedroom 1" style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Bed type
          <select name="bedType" defaultValue="double" style={inputStyle}>
            {bedTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Qty
          <input name="quantity" type="number" min={1} defaultValue={1} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Order
          <input
            name="ordering"
            type="number"
            min={0}
            defaultValue={arrangements.length}
            style={inputStyle}
          />
        </label>
        <button type="submit" disabled={isPending} style={buttonStyle}>
          {isPending ? "Adding…" : "Add"}
        </button>
      </form>
      {state.error ? (
        <span role="alert" style={errorTextStyle}>
          {state.error}
        </span>
      ) : null}
    </div>
  );
}
