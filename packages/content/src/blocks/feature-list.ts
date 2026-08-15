import { z } from "zod";
import type { BlockDefinition } from "../block-registry";
import { localizedStringSchema } from "../localized-string";

const featureItemSchema = z.object({
  // A semantic icon key (e.g. "pool", "wifi") resolved to an actual icon
  // by the renderer's own closed icon set — never an arbitrary image URL
  // or markup, same governability reasoning as docs/adr/0011-theme-token-model.md.
  iconKey: z.string().trim().min(1).max(64).optional(),
  title: localizedStringSchema,
  description: localizedStringSchema.optional(),
});

export const featureListPropsSchema = z.object({
  heading: localizedStringSchema.optional(),
  items: z.array(featureItemSchema).min(1).max(20),
});

export type FeatureListProps = z.infer<typeof featureListPropsSchema>;

export const featureListBlockV1: BlockDefinition<FeatureListProps> = {
  type: "feature-list",
  version: 1,
  schema: featureListPropsSchema,
  capabilities: { domainBound: false },
};
