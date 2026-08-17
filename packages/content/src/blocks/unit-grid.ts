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
  // v0.6, optional/defaulted-false: shows each card's effective bed count
  // (structured sleeping-arrangement detail when present, else the raw
  // `beds` aggregate — see `packages/rentals`' `buildUnitGuestView`).
  // Omitted on any already-stored `@1` instance keeps today's card layout
  // unchanged, so this is a non-breaking addition.
  showBedSummary: z.boolean().default(false),
});

export type UnitGridProps = z.infer<typeof unitGridPropsSchema>;

export const unitGridBlockV1: BlockDefinition<UnitGridProps> = {
  type: "unit-grid",
  version: 1,
  schema: unitGridPropsSchema,
  capabilities: { domainBound: true },
  references: (props) => [
    { kind: "domain", domainType: "property", id: props.propertyId },
    ...(props.unitIds ?? []).map((id) => ({
      kind: "domain" as const,
      domainType: "unit" as const,
      id,
    })),
  ],
};
