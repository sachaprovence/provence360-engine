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
  // v0.6: this prop's *meaning* becomes disclosure-aware (the renderer now
  // consults the Property's own `locationDisclosure` setting to decide
  // *how much* address to show, never leaking beyond it) without changing
  // this schema — same precedent as v0.5's `hero@1` renderer switching to
  // frozen media without a props-schema change, since only the data
  // *source*, not the props *shape*, changed. See
  // docs/adr/0018-rental-domain-guest-experience.md.
  showAddress: z.boolean().default(true),
  // New, optional, defaulted-false: an already-stored `@1` block instance
  // that never set these keeps rendering exactly as before (no check-in/
  // out or policy summary), so this is a non-breaking addition, not a
  // reason to bump to `@2`.
  showCheckInOut: z.boolean().default(false),
  showPolicies: z.boolean().default(false),
});

export type PropertySummaryProps = z.infer<typeof propertySummaryPropsSchema>;

export const propertySummaryBlockV1: BlockDefinition<PropertySummaryProps> = {
  type: "property-summary",
  version: 1,
  schema: propertySummaryPropsSchema,
  capabilities: { domainBound: true },
  references: (props) => [{ kind: "domain", domainType: "property", id: props.propertyId }],
};
