import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getUnit,
  listAmenities,
  listAmenitiesForUnit,
  listSleepingArrangementsForUnit,
} from "@provence360/rentals";
import { withTenantPage } from "@/lib/actor";
import { AmenitiesForm } from "./amenities-form";
import { SleepingArrangementsForm } from "./sleeping-arrangements-form";
import { UnitEditForm } from "./unit-edit-form";

export const dynamic = "force-dynamic";

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string; siteId: string; propertyId: string; unitId: string }>;
}) {
  const { tenantId, siteId, propertyId, unitId } = await params;

  const { unit, catalog, attached, sleepingArrangements, canUpdate } = await withTenantPage(
    tenantId,
    "unit.read",
    async (tx, actor) => ({
      unit: await getUnit(tx, unitId),
      catalog: await listAmenities(tx),
      attached: await listAmenitiesForUnit(tx, unitId),
      sleepingArrangements: await listSleepingArrangementsForUnit(tx, unitId),
      canUpdate: actor.permissions.has("unit.update"),
    }),
  );

  if (!unit || unit.propertyId !== propertyId) notFound();

  return (
    <div>
      <p style={{ fontSize: 13 }}>
        <Link
          href={`/admin/tenants/${tenantId}/sites/${siteId}/properties/${propertyId}`}
          style={{ color: "#6b7280" }}
        >
          ← Property
        </Link>
      </p>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>{unit.publicName}</h1>

      {canUpdate ? (
        <UnitEditForm
          tenantId={tenantId}
          siteId={siteId}
          propertyId={propertyId}
          unitId={unitId}
          unit={unit}
        />
      ) : (
        <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 20 }}>
          {unit.maxGuests ?? "—"} guests · {unit.bedrooms ?? "—"} bedrooms · {unit.status}
        </p>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Amenities</h2>
      {canUpdate ? (
        <AmenitiesForm
          tenantId={tenantId}
          siteId={siteId}
          propertyId={propertyId}
          unitId={unitId}
          catalog={catalog}
          attachedIds={attached.map((a) => a.amenityId)}
        />
      ) : (
        <ul style={{ fontSize: 14, color: "#374151" }}>
          {attached.map((amenity) => (
            <li key={amenity.amenityId}>{amenity.label}</li>
          ))}
        </ul>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 8, marginTop: 20 }}>Sleeping arrangements</h2>
      {canUpdate ? (
        <SleepingArrangementsForm
          tenantId={tenantId}
          siteId={siteId}
          propertyId={propertyId}
          unitId={unitId}
          arrangements={sleepingArrangements}
        />
      ) : (
        <ul style={{ fontSize: 14, color: "#374151" }}>
          {sleepingArrangements.map((row) => (
            <li key={row.id}>
              {row.roomLabel ? `${row.roomLabel}: ` : ""}
              {row.quantity} × {row.bedType}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
