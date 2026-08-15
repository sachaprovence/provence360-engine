import { listAuditLogs } from "@provence360/observability";
import { withTenantPage } from "@/lib/actor";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  const entries = await withTenantPage(tenantId, "audit.read", (tx) => listAuditLogs(tx));

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Audit log</h1>
      {entries.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>Nothing recorded yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: "6px 4px" }}>When</th>
              <th style={{ padding: "6px 4px" }}>Actor</th>
              <th style={{ padding: "6px 4px" }}>Action</th>
              <th style={{ padding: "6px 4px" }}>Target</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "6px 4px", color: "#6b7280" }}>
                  {entry.createdAt.toISOString()}
                </td>
                <td style={{ padding: "6px 4px" }}>{entry.actorEmail ?? "system"}</td>
                <td style={{ padding: "6px 4px" }}>{entry.action}</td>
                <td style={{ padding: "6px 4px", color: "#6b7280" }}>
                  {entry.targetType}
                  {entry.targetId ? ` · ${entry.targetId.slice(0, 8)}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
