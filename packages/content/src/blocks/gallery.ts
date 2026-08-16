import { z } from "zod";
import { uuidSchema } from "@provence360/validation";
import type { BlockDefinition } from "../block-registry";
import { localizedStringSchema } from "../localized-string";

// Holds references (MediaAsset ids), never bare URLs — see
// docs/adr/0012-media-asset-and-amenity-catalog.md. The renderer resolves
// each id to a real, tenant-scoped MediaAsset at render time; a stale or
// cross-tenant id simply resolves to nothing (see docs/RENDERING.md).
export const galleryPropsSchema = z.object({
  mediaAssetIds: z.array(uuidSchema).min(1).max(50),
  caption: localizedStringSchema.optional(),
});

export type GalleryProps = z.infer<typeof galleryPropsSchema>;

export const galleryBlockV1: BlockDefinition<GalleryProps> = {
  type: "gallery",
  version: 1,
  schema: galleryPropsSchema,
  capabilities: { domainBound: false },
};
