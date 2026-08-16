import { z } from "zod";
import { safeHrefSchema } from "@provence360/validation";
import type { BlockDefinition } from "../block-registry";
import { localizedStringSchema } from "../localized-string";

export const ctaPropsSchema = z.object({
  heading: localizedStringSchema.optional(),
  body: localizedStringSchema.optional(),
  buttonLabel: localizedStringSchema,
  buttonHref: safeHrefSchema,
});

export type CtaProps = z.infer<typeof ctaPropsSchema>;

export const ctaBlockV1: BlockDefinition<CtaProps> = {
  type: "cta",
  version: 1,
  schema: ctaPropsSchema,
  capabilities: { domainBound: false },
};
