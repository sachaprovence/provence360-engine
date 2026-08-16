import { listDomainsForTenant } from "@provence360/domains";
import { listSites } from "@provence360/sites";
import { withTenantPage } from "@/lib/actor";
import { CreateDomainForm } from "./create-domain-form";

export const dynamic = "force-dynamic";

export default async function DomainsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  const { domainList, siteList, canCreate } = await withTenantPage(
    tenantId,
    "domain.read",
    async (tx, actor) => ({
      domainList: await listDomainsForTenant(tx),
      siteList: await listSites(tx),
      canCreate: actor.permissions.has("domain.create"),
    }),
  );

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Domains</h1>
      {canCreate && siteList.length > 0 ? (
        <CreateDomainForm tenantId={tenantId} sites={siteList} />
      ) : null}
      {domainList.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>No domains yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: "6px 4px" }}>Hostname</th>
              <th style={{ padding: "6px 4px" }}>Primary</th>
              <th style={{ padding: "6px 4px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {domainList.map((domain) => (
              <tr key={domain.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "6px 4px" }}>{domain.hostname}</td>
                <td style={{ padding: "6px 4px" }}>{domain.isPrimary ? "Yes" : ""}</td>
                <td style={{ padding: "6px 4px" }}>{domain.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
