import sharp, { type Sharp } from "sharp";
import { logger } from "@provence360/observability";
import {
  type AcceptedImageFormat,
  IMAGE_VARIANT_TOKENS,
  type ImageVariantToken,
  VARIANT_MAX_WIDTH,
} from "../domain/constants";
import type { MediaVariantEntry, MediaVariantsV1 } from "../domain/media-variants";
import { MEDIA_VARIANTS_VERSION } from "../domain/media-variants";
import { MediaStorageUnavailableError } from "../errors";
import { buildVariantStorageKey } from "../upload/object-keys";
import type { ObjectStorage } from "../storage/object-storage";
import type { ValidatedImage } from "../validation/image-validation";

interface ResizedVariant {
  token: ImageVariantToken;
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Resizes the already-validated original into every variant that's
 * actually smaller than it — never upscaled (brief §10). A source
 * narrower than a given variant's target width simply has no entry for
 * that variant; consumers fall back to the original for anything larger
 * than the widest variant that exists. Re-encodes into the *same* format
 * the original decoded as — no cross-format transcoding surprises.
 */
export async function generateImageVariants(
  bytes: Buffer,
  source: Pick<ValidatedImage, "format" | "width">,
): Promise<ResizedVariant[]> {
  const results: ResizedVariant[] = [];
  for (const token of IMAGE_VARIANT_TOKENS) {
    const targetWidth = VARIANT_MAX_WIDTH[token];
    if (source.width <= targetWidth) continue; // never upscale — original already smaller
    // `.rotate()` with no arguments auto-orients from the source's own
    // EXIF tag before resizing, then strips the (now-redundant) tag from
    // the output — sharp's standard pattern for this, and required here:
    // without it, a variant's *pixels* stay in the raw, un-rotated layout
    // while `source.width`/`.height` (from `validateImageBytes`, already
    // orientation-corrected) describe the *displayed* layout, so target
    // dimensions computed from the corrected axis would be applied to the
    // wrong physical axis, and — because re-encoding here drops the
    // orientation tag regardless — a viewer would have no way to
    // recover the correct orientation from the variant it received.
    const resized = sharp(bytes).rotate().resize({ width: targetWidth, withoutEnlargement: true });
    const buffer = await toFormat(resized, source.format).toBuffer();
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) continue;
    results.push({ token, buffer, width: metadata.width, height: metadata.height });
  }
  return results;
}

/** Uploads each resized variant and returns the validated, storable metadata shape. */
export async function storeImageVariants(
  storage: ObjectStorage,
  tenantId: string,
  mediaAssetId: string,
  variants: ResizedVariant[],
  contentType: string,
): Promise<MediaVariantsV1> {
  const result: MediaVariantsV1 = { version: MEDIA_VARIANTS_VERSION };
  for (const variant of variants) {
    const storageKey = buildVariantStorageKey(tenantId, mediaAssetId, variant.token);
    try {
      await storage.putObject(storageKey, variant.buffer, { contentType });
    } catch (error) {
      logger.warn("media.storage.put_failed", {
        tenantId,
        mediaAssetId,
        variant: variant.token,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new MediaStorageUnavailableError();
    }
    const entry: MediaVariantEntry = {
      storageKey,
      width: variant.width,
      height: variant.height,
      byteSize: variant.buffer.byteLength,
    };
    result[variant.token] = entry;
  }
  return result;
}

function toFormat(pipeline: Sharp, format: AcceptedImageFormat): Sharp {
  if (format === "jpeg") return pipeline.jpeg();
  if (format === "png") return pipeline.png();
  return pipeline.webp();
}
