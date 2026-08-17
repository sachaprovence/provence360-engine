import { z } from "zod";
import { uuidSchema } from "@provence360/validation";
import type { BlockDefinition } from "../block-registry";
import { localizedStringSchema } from "../localized-string";

// A DOMAIN block: references a Unit; the actual amenity list (key,
// category, label, icon) is loaded from the shared catalog
// (`packages/rentals`' `listAmenitiesForUnit`) at render time, never
// duplicated into this block's own JSON. See
// docs/adr/0012-media-asset-and-amenity-catalog.md.
export const amenitiesPropsSchema = z.object({
  unitId: uuidSchema,
  heading: localizedStringSchema.optional(),
});

export type AmenitiesProps = z.infer<typeof amenitiesPropsSchema>;

export const amenitiesBlockV1: BlockDefinition<AmenitiesProps> = {
  type: "amenities",
  version: 1,
  schema: amenitiesPropsSchema,
  capabilities: { domainBound: true },
  references: (props) => [{ kind: "domain", domainType: "unit", id: props.unitId }],
};
