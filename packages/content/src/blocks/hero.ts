import { z } from "zod";
import { safeHrefSchema, uuidSchema } from "@provence360/validation";
import type { BlockDefinition } from "../block-registry";
import { localizedStringSchema } from "../localized-string";

export const heroPropsSchema = z.object({
  headline: localizedStringSchema,
  subheadline: localizedStringSchema.optional(),
  backgroundMediaId: uuidSchema.optional(),
  ctaLabel: localizedStringSchema.optional(),
  ctaHref: safeHrefSchema.optional(),
});

export type HeroProps = z.infer<typeof heroPropsSchema>;

export const heroBlockV1: BlockDefinition<HeroProps> = {
  type: "hero",
  version: 1,
  schema: heroPropsSchema,
  capabilities: { domainBound: false },
  references: (props) =>
    props.backgroundMediaId ? [{ kind: "media", id: props.backgroundMediaId }] : [],
};
