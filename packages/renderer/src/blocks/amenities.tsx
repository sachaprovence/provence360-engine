import type { AmenitiesProps } from "@provence360/content";
import { resolveLocalizedString } from "@provence360/content";
import {
  getProperty,
  getPublicProperty,
  getPublicUnit,
  getUnit,
  listAmenitiesForProperty,
  listAmenitiesForUnit,
} from "@provence360/rentals";
import type { BlockRenderer } from "../block-renderer-registry";
import { DomainReferenceUnavailable } from "./domain-reference-unavailable";

// A DOMAIN block: references either a Unit or a Property (v0.6) — the
// actual amenity list (key, category, label, icon) is loaded from the
// shared catalog at render time, never duplicated into this block's own
// JSON. Under `context.publicOnly`, the referenced Unit/Property is first
// gated on being currently public (`getPublicUnit`/`getPublicProperty`) —
// a draft/archived owner (or one belonging to another tenant) resolves to
// `DomainReferenceUnavailable`, never a leaked amenity list for
// not-yet-public rental data.
export const amenitiesRendererV1: BlockRenderer<AmenitiesProps> = async ({
  id,
  props,
  context,
}) => {
  const t = context.tokens;
  const heading = props.heading
    ? resolveLocalizedString(props.heading, context.locale, context.defaultLocale)
    : undefined;
  const publicView = context.publicOnly === true;

  let amenities: { amenityId: string; label: string }[];
  if (props.unitId) {
    const unit = publicView
      ? await getPublicUnit(context.tx, props.unitId)
      : await getUnit(context.tx, props.unitId);
    if (!unit) return <DomainReferenceUnavailable id={id} blockType="amenities" tokens={t} />;
    amenities = await listAmenitiesForUnit(context.tx, props.unitId);
  } else if (props.propertyId) {
    const property = publicView
      ? await getPublicProperty(context.tx, props.propertyId)
      : await getProperty(context.tx, props.propertyId);
    if (!property) return <DomainReferenceUnavailable id={id} blockType="amenities" tokens={t} />;
    amenities = await listAmenitiesForProperty(context.tx, props.propertyId);
  } else {
    return <DomainReferenceUnavailable id={id} blockType="amenities" tokens={t} />;
  }

  return (
    <section key={id} data-block="amenities" style={{ padding: t["spacing.medium"] }}>
      {heading ? (
        <h2 style={{ fontFamily: t["font.heading"], color: t["color.text"] }}>{heading}</h2>
      ) : null}
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          display: "flex",
          flexWrap: "wrap",
          gap: t["spacing.small"],
        }}
      >
        {amenities.map((amenity) => (
          <li
            key={amenity.amenityId}
            style={{
              padding: `${t["spacing.small"]} ${t["spacing.medium"]}`,
              borderRadius: t["radius.small"],
              background: t["color.surface"],
              color: t["color.text"],
              fontFamily: t["font.body"],
            }}
          >
            {amenity.label}
          </li>
        ))}
      </ul>
    </section>
  );
};
