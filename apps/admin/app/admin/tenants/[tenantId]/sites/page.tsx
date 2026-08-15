import Link from "next/link";
import { listSites } from "@provence360/sites";
import { withTenantPage } from "@/lib/actor";
import { CreateSiteForm } from "./create-site-form";

export const dynamic = "force-dynamic";

export default async function SitesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  const { siteList, canCreate } = await withTenantPage(
    tenantId,
    "site.read",
    async (tx, actor) => ({
      siteList: await listSites(tx),
      canCreate: actor.permissions.has("site.create"),
    }),
  );

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Sites</h1>
      {canCreate ? <CreateSiteForm tenantId={tenantId} /> : null}
      {siteList.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>No sites yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: "6px 4px" }}>Name</th>
              <th style={{ padding: "6px 4px" }}>Slug</th>
              <th style={{ padding: "6px 4px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {siteList.map((site) => (
              <tr key={site.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "6px 4px" }}>
                  <Link
                    href={`/admin/tenants/${tenantId}/sites/${site.id}`}
                    style={{ color: "#111827" }}
                  >
                    {site.name}
                  </Link>
                </td>
                <td style={{ padding: "6px 4px", color: "#6b7280" }}>{site.slug}</td>
                <td style={{ padding: "6px 4px" }}>{site.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
