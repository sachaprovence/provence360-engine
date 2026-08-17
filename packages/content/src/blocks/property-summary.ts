import { z } from "zod";
import { uuidSchema } from "@provence360/validation";
import type { BlockDefinition } from "../block-registry";

// A DOMAIN block (section 15 of the brief): holds a *reference* to a
// Property plus presentation options only — never a copy of the
// Property's name, address, or description. The renderer loads the real
// row from `packages/rentals` at render time, scoped to the current
// tenant, so the Rental domain stays the single source of truth.
export const propertySummaryPropsSchema = z.object({
  propertyId: uuidSchema,
  showDescription: z.boolean().default(true),
  showAddress: z.boolean().default(true),
});

export type PropertySummaryProps = z.infer<typeof propertySummaryPropsSchema>;

export const propertySummaryBlockV1: BlockDefinition<PropertySummaryProps> = {
  type: "property-summary",
  version: 1,
  schema: propertySummaryPropsSchema,
  capabilities: { domainBound: true },
  references: (props) => [{ kind: "domain", domainType: "property", id: props.propertyId }],
};
