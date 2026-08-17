"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonStyle } from "@/lib/form-styles";
import { setPropertyAmenitiesAction } from "../actions";

export function PropertyAmenitiesForm({
  tenantId,
  siteId,
  propertyId,
  catalog,
  attachedIds,
}: {
  tenantId: string;
  siteId: string;
  propertyId: string;
  catalog: ReadonlyArray<{ id: string; label: string; category: string }>;
  attachedIds: readonly string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(attachedIds));
  const [isPending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      await setPropertyAmenitiesAction(tenantId, siteId, propertyId, [...selected]);
      router.refresh();
    });
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        {catalog.map((amenity) => (
          <label
            key={amenity.id}
            style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}
          >
            <input
              type="checkbox"
              checked={selected.has(amenity.id)}
              onChange={() => {
                toggle(amenity.id);
              }}
            />
            {amenity.label}
            <span style={{ color: "#9ca3af", fontSize: 12 }}>({amenity.category})</span>
          </label>
        ))}
      </div>
      <button type="button" disabled={isPending} onClick={save} style={buttonStyle}>
        {isPending ? "Saving…" : "Save property amenities"}
      </button>
    </div>
  );
}
