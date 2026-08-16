import Link from "next/link";
import { notFound } from "next/navigation";
import { getProperty, listUnitsForProperty } from "@provence360/rentals";
import { withTenantPage } from "@/lib/actor";
import { tableStyle, tdStyle, thStyle } from "@/lib/form-styles";
import { CreateUnitForm } from "./create-unit-form";
import { PropertyEditForm } from "./property-edit-form";

export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string; siteId: string; propertyId: string }>;
}) {
  const { tenantId, siteId, propertyId } = await params;

  const { property, unitList, canUpdate, canCreateUnit } = await withTenantPage(
    tenantId,
    "property.read",
    async (tx, actor) => ({
      property: await getProperty(tx, propertyId),
      unitList: await listUnitsForProperty(tx, propertyId),
      canUpdate: actor.permissions.has("property.update"),
      canCreateUnit: actor.permissions.has("unit.create"),
    }),
  );

  if (!property || property.siteId !== siteId) notFound();

  return (
    <div>
      <p style={{ fontSize: 13 }}>
        <Link
          href={`/admin/tenants/${tenantId}/sites/${siteId}/properties`}
          style={{ color: "#6b7280" }}
        >
          ← Properties
        </Link>
      </p>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>{property.publicName}</h1>

      {canUpdate ? (
        <PropertyEditForm
          tenantId={tenantId}
          siteId={siteId}
          propertyId={propertyId}
          property={property}
        />
      ) : (
        <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 20 }}>
          {property.propertyType} · {property.addressCity} · {property.status}
        </p>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Units</h2>
      {canCreateUnit ? (
        <CreateUnitForm tenantId={tenantId} siteId={siteId} propertyId={propertyId} />
      ) : null}

      {unitList.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>No units yet.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Max guests</th>
              <th style={thStyle}>Bedrooms</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {unitList.map((unit) => (
              <tr key={unit.id}>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/tenants/${tenantId}/sites/${siteId}/properties/${propertyId}/units/${unit.id}`}
                    style={{ color: "#111827" }}
                  >
                    {unit.publicName}
                  </Link>
                </td>
                <td style={tdStyle}>{unit.maxGuests ?? "—"}</td>
                <td style={tdStyle}>{unit.bedrooms ?? "—"}</td>
                <td style={tdStyle}>{unit.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
