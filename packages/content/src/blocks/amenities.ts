import { z } from "zod";
import { uuidSchema } from "@provence360/validation";
import type { BlockDefinition } from "../block-registry";
import { localizedStringSchema } from "../localized-string";

// A DOMAIN block: references either a Unit or a Property (v0.6, section 11
// of the brief — Amenities were Unit-only; a Property can now have its own
// amenities, e.g. a shared pool, distinct from any one Unit's). Exactly
// one of `unitId`/`propertyId` must be set — never both, never neither.
// Every pre-v0.6 stored instance always has `unitId` set and `propertyId`
// omitted, so it still validates unchanged; this is a non-breaking
// widening, not a reason to bump to `@2`. The actual amenity list (key,
// category, label, icon) is loaded from the shared catalog
// (`packages/rentals`' `listAmenitiesForUnit`/`listAmenitiesForProperty`)
// at render time, never duplicated into this block's own JSON. See
// docs/adr/0012-media-asset-and-amenity-catalog.md and
// docs/adr/0018-rental-domain-guest-experience.md.
export const amenitiesPropsSchema = z
  .object({
    unitId: uuidSchema.optional(),
    propertyId: uuidSchema.optional(),
    heading: localizedStringSchema.optional(),
  })
  .refine((v) => (v.unitId === undefined) !== (v.propertyId === undefined), {
    message: "Exactly one of unitId or propertyId must be provided",
    path: ["unitId"],
  });

export type AmenitiesProps = z.infer<typeof amenitiesPropsSchema>;

export const amenitiesBlockV1: BlockDefinition<AmenitiesProps> = {
  type: "amenities",
  version: 1,
  schema: amenitiesPropsSchema,
  capabilities: { domainBound: true },
  references: (props) =>
    props.unitId
      ? [{ kind: "domain", domainType: "unit", id: props.unitId }]
      : props.propertyId
        ? [{ kind: "domain", domainType: "property", id: props.propertyId }]
        : [],
};
