import type { UnitGridProps } from "@provence360/content";
import { listUnitsForProperty } from "@provence360/rentals";
import type { BlockRenderer } from "../block-renderer-registry";

// A DOMAIN block: `listUnitsForProperty` is already tenant-scoped (it
// filters on `units.tenant_id = <current tenant>`), so a `propertyId`
// belonging to another tenant simply yields zero rows here — never
// another tenant's Units. When `unitIds` is set, it narrows/reorders the
// tenant's own fetched Units; it is never used to reach outside what the
// tenant-scoped query already returned.
export const unitGridRendererV1: BlockRenderer<UnitGridProps> = async ({ id, props, context }) => {
  const t = context.tokens;
  const allUnits = await listUnitsForProperty(context.tx, props.propertyId);
  // Draft/archived Units are real rows an owner is still editing or has
  // retired — never shown on the public site regardless of block config.
  const units = allUnits.filter(
    (unit) => unit.status === "active" || unit.status === "not_bookable_separately",
  );
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const ordered = props.unitIds
    ? props.unitIds.map((unitId) => byId.get(unitId)).filter((unit) => unit !== undefined)
    : units;

  return (
    <section key={id} data-block="unit-grid" style={{ padding: t["spacing.medium"] }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${String(props.columns)}, 1fr)`,
          gap: t["spacing.medium"],
        }}
      >
        {ordered.map((unit) => (
          <article
            key={unit.id}
            style={{
              padding: t["spacing.medium"],
              borderRadius: t["radius.medium"],
              background: t["color.surface"],
              color: t["color.text"],
            }}
          >
            <h3 style={{ fontFamily: t["font.heading"], margin: 0 }}>{unit.publicName}</h3>
            <p style={{ color: t["color.muted"], fontFamily: t["font.body"], margin: 0 }}>
              {unit.maxGuests != null ? `${String(unit.maxGuests)} guests` : null}
              {unit.bedrooms != null ? ` · ${String(unit.bedrooms)} bedrooms` : null}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
};
