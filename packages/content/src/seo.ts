import { z } from "zod";
import { uuidSchema } from "@provence360/validation";
import { localizedStringSchema } from "./localized-string";

// A small, validated SEO contract — not a full SEO engine (see
// docs/RENDERING.md). `pages.seo` is validated against this on every
// write; the renderer produces <title>/<meta> tags from it, never from
// unvalidated free text.
export const seoSchema = z.object({
  title: localizedStringSchema.optional(),
  description: localizedStringSchema.optional(),
  canonicalPath: z.string().trim().max(2048).optional(),
  noIndex: z.boolean().optional(),
  noFollow: z.boolean().optional(),
  ogImageMediaId: uuidSchema.optional(),
});

export type Seo = z.infer<typeof seoSchema>;
