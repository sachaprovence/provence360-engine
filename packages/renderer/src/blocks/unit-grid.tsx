import type { UnitGridProps } from "@provence360/content";
import { getUnitGuestView, listPublicUnitsForProperty } from "@provence360/rentals";
import type { BlockRenderer } from "../block-renderer-registry";

// A DOMAIN block: `listPublicUnitsForProperty` is already tenant-scoped
// (it filters on `units.tenant_id = <current tenant>`) and additionally
// filters to `isPublicUnitStatus` (active / not_bookable_separately) —
// the same filter this block applied inline pre-v0.6, now the one shared
// predicate every public-facing caller reads from (see
// `packages/rentals`' `isPublicUnitStatus`). A `propertyId` belonging to
// another tenant simply yields zero rows here — never another tenant's
// Units. When `unitIds` is set, it narrows/reorders the tenant's own
// fetched Units; it is never used to reach outside what the tenant-scoped
// query already returned.
export const unitGridRendererV1: BlockRenderer<UnitGridProps> = async ({ id, props, context }) => {
  const t = context.tokens;
  const units = await listPublicUnitsForProperty(context.tx, props.propertyId);
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const ordered = props.unitIds
    ? props.unitIds.map((unitId) => byId.get(unitId)).filter((unit) => unit !== undefined)
    : units;

  // Only fetched when actually displayed — an N+1 over a block-capped
  // (`unitGridPropsSchema`'s `unitIds.max(50)`) small list, not worth
  // batching into its own bulk query for a display toggle most Units won't
  // even use.
  const bedSummaries = props.showBedSummary
    ? new Map(
        await Promise.all(
          ordered.map(
            async (unit) => [unit.id, await getUnitGuestView(context.tx, unit.id)] as const,
          ),
        ),
      )
    : null;

  return (
    <section key={id} data-block="unit-grid" style={{ padding: t["spacing.medium"] }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${String(props.columns)}, 1fr)`,
          gap: t["spacing.medium"],
        }}
      >
        {ordered.map((unit) => {
          const bedCount = bedSummaries?.get(unit.id)?.effectiveBedCount;
          return (
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
                {bedCount != null ? ` · ${String(bedCount)} beds` : null}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
};
