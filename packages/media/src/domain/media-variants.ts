import { z } from "zod";
import { IMAGE_VARIANT_TOKENS } from "./constants";

/**
 * The closed, versioned shape stored in `media_assets.variants` (jsonb).
 * Versioned exactly like `SiteBrandingV1`/`SiteSnapshot` — see
 * docs/adr/0022-media-ingestion-asset-delivery.md — so a future v2 variant
 * shape has an explicit upgrade path instead of a silent cast. `{}` (no
 * `version` key) is the valid "no variants generated" state for a
 * non-image asset or a pre-v0.9 row, distinguished from a real, empty
 * object by `resolveMediaVariants` below, not by the shape itself.
 */
export const MEDIA_VARIANTS_VERSION = 1 as const;

const variantEntrySchema = z.object({
  storageKey: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().positive(),
});
export type MediaVariantEntry = z.infer<typeof variantEntrySchema>;

export const mediaVariantsV1Schema = z
  .object({
    version: z.literal(MEDIA_VARIANTS_VERSION),
    thumbnail: variantEntrySchema.optional(),
    small: variantEntrySchema.optional(),
    medium: variantEntrySchema.optional(),
    large: variantEntrySchema.optional(),
  })
  .strict();
export type MediaVariantsV1 = z.infer<typeof mediaVariantsV1Schema>;

// A defensive, literal compile-time check that the schema's optional keys
// stay exactly in sync with the closed token registry if either one changes.
const _variantKeysMatchTokens: readonly (keyof Omit<MediaVariantsV1, "version">)[] =
  IMAGE_VARIANT_TOKENS;
void _variantKeysMatchTokens;

/**
 * Parses `media_assets.variants` — never a blind cast. `null`/`undefined`/
 * `{}` (the column's own default, and every pre-v0.9 row) all resolve to
 * "no variants," never an error; anything shaped like a real `{version:
 * 1, ...}` object is validated and returned as-is; anything else throws
 * (a corrupt row, not a version this code understands).
 */
export function resolveMediaVariants(raw: unknown): MediaVariantsV1 | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object" && raw !== null && Object.keys(raw).length === 0) return null;
  return mediaVariantsV1Schema.parse(raw);
}
