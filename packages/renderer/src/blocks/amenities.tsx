import type { AmenitiesProps } from "@provence360/content";
import { resolveLocalizedString } from "@provence360/content";
import { listAmenitiesForUnit } from "@provence360/rentals";
import type { BlockRenderer } from "../block-renderer-registry";

// A DOMAIN block: `listAmenitiesForUnit` joins the platform-level
// amenity catalog against `unit_amenities`, itself tenant-scoped — a
// `unitId` belonging to another tenant yields zero rows, never another
// tenant's amenity attachments (the catalog rows themselves aren't
// tenant data, only which unit holds which amenity is).
export const amenitiesRendererV1: BlockRenderer<AmenitiesProps> = async ({
  id,
  props,
  context,
}) => {
  const t = context.tokens;
  const heading = props.heading
    ? resolveLocalizedString(props.heading, context.locale, context.defaultLocale)
    : undefined;
  const amenities = await listAmenitiesForUnit(context.tx, props.unitId);

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
