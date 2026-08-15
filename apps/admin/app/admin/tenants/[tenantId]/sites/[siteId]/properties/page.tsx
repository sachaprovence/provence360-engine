import Link from "next/link";
import { listPropertiesForSite } from "@provence360/rentals";
import { withTenantPage } from "@/lib/actor";
import { tableStyle, tdStyle, thStyle } from "@/lib/form-styles";
import { CreatePropertyForm } from "./create-property-form";

export const dynamic = "force-dynamic";

export default async function SitePropertiesPage({
  params,
}: {
  params: Promise<{ tenantId: string; siteId: string }>;
}) {
  const { tenantId, siteId } = await params;

  const { propertyList, canCreate } = await withTenantPage(
    tenantId,
    "property.read",
    async (tx, actor) => ({
      propertyList: await listPropertiesForSite(tx, siteId),
      canCreate: actor.permissions.has("property.create"),
    }),
  );

  return (
    <div>
      <p style={{ fontSize: 13 }}>
        <Link href={`/admin/tenants/${tenantId}/sites/${siteId}`} style={{ color: "#6b7280" }}>
          ← Site
        </Link>
      </p>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Properties</h1>
      {canCreate ? <CreatePropertyForm tenantId={tenantId} siteId={siteId} /> : null}

      {propertyList.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>No properties yet.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>City</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {propertyList.map((property) => (
              <tr key={property.id}>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/tenants/${tenantId}/sites/${siteId}/properties/${property.id}`}
                    style={{ color: "#111827" }}
                  >
                    {property.publicName}
                  </Link>
                </td>
                <td style={tdStyle}>{property.propertyType}</td>
                <td style={{ ...tdStyle, color: "#6b7280" }}>{property.addressCity}</td>
                <td style={tdStyle}>{property.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
