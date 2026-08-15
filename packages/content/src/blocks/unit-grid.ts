import { z } from "zod";
import { uuidSchema } from "@provence360/validation";
import type { BlockDefinition } from "../block-registry";

// A DOMAIN block: references a Property and (optionally) a specific
// subset/order of its Units — never a copy of unit names, capacities, or
// photos. Omitting `unitIds` means "every active Unit of this Property,
// in their own `ordering`" (see `packages/rentals`' `listUnitsForProperty`).
export const unitGridPropsSchema = z.object({
  propertyId: uuidSchema,
  unitIds: z.array(uuidSchema).max(50).optional(),
  columns: z.number().int().min(1).max(4).default(3),
});

export type UnitGridProps = z.infer<typeof unitGridPropsSchema>;

export const unitGridBlockV1: BlockDefinition<UnitGridProps> = {
  type: "unit-grid",
  version: 1,
  schema: unitGridPropsSchema,
  capabilities: { domainBound: true },
};
