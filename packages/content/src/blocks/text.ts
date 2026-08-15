import { z } from "zod";
import type { BlockDefinition } from "../block-registry";
import { localizedStringSchema } from "../localized-string";

// Plain text only — a block-level line break ("\n") separates paragraphs
// at render time. No markup, no HTML: see section 33 of the brief and
// docs/RENDERING.md#security — this is the deliberately boring, safe
// default rather than a rich-text editor's document model.
export const textPropsSchema = z.object({
  heading: localizedStringSchema.optional(),
  body: localizedStringSchema,
});

export type TextProps = z.infer<typeof textPropsSchema>;

export const textBlockV1: BlockDefinition<TextProps> = {
  type: "text",
  version: 1,
  schema: textPropsSchema,
  capabilities: { domainBound: false },
};
