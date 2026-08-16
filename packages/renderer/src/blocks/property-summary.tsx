import type { PropertySummaryProps } from "@provence360/content";
import { getProperty } from "@provence360/rentals";
import type { BlockRenderer } from "../block-renderer-registry";
import { DomainReferenceUnavailable } from "./domain-reference-unavailable";

// A DOMAIN block: `props` holds only `propertyId` + presentation flags —
// the actual Property row is loaded here, scoped to the current tenant
// via `context.tx` (RLS + `getProperty`'s own `requireCurrentTenantId()`
// check). A `propertyId` belonging to another tenant, or one that no
// longer exists, resolves to `null` — never another tenant's data, and
// never a thrown error that would take the whole page down with it (see
// docs/RENDERING.md#error-handling and the cross-tenant renderer test).
export const propertySummaryRendererV1: BlockRenderer<PropertySummaryProps> = async ({
  id,
  props,
  context,
}) => {
  const t = context.tokens;
  const property = await getProperty(context.tx, props.propertyId);
  if (!property) {
    return <DomainReferenceUnavailable id={id} blockType="property-summary" tokens={t} />;
  }

  const address = [property.addressLine1, property.addressCity, property.addressCountry]
    .filter(Boolean)
    .join(", ");

  return (
    <section
      key={id}
      data-block="property-summary"
      style={{ padding: t["spacing.medium"], color: t["color.text"] }}
    >
      <h2 style={{ fontFamily: t["font.heading"], marginTop: 0 }}>{property.publicName}</h2>
      {props.showDescription && property.description ? (
        <p style={{ fontFamily: t["font.body"] }}>{property.description}</p>
      ) : null}
      {props.showAddress && address ? (
        <p style={{ color: t["color.muted"], fontFamily: t["font.body"] }}>{address}</p>
      ) : null}
    </section>
  );
};
