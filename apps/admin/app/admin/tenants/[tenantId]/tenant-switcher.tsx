"use client";

import type { ChangeEvent } from "react";
import { useRouter } from "next/navigation";

export function TenantSwitcher({
  currentTenantId,
  memberships,
}: {
  currentTenantId: string;
  memberships: Array<{ tenantId: string; tenantName: string }>;
}) {
  const router = useRouter();

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    router.push(`/admin/tenants/${event.target.value}`);
  }

  return (
    <div>
      <label
        htmlFor="tenant-switcher"
        style={{ display: "block", fontSize: 11, color: "#6b7280", marginBottom: 4 }}
      >
        Tenant
      </label>
      <select
        id="tenant-switcher"
        defaultValue={currentTenantId}
        onChange={handleChange}
        style={{
          width: "100%",
          padding: "6px 8px",
          border: "1px solid #d1d5db",
          borderRadius: 6,
          fontSize: 14,
        }}
      >
        {memberships.map((m) => (
          <option key={m.tenantId} value={m.tenantId}>
            {m.tenantName}
          </option>
        ))}
      </select>
    </div>
  );
}
