import { randomUUID } from "node:crypto";
import { createMediaAsset } from "@provence360/content";
import type { AppTx } from "@provence360/database";
import { logger } from "@provence360/observability";
import { requireCurrentTenantId, withTenantContext } from "@provence360/tenant";
import type { MediaAssetRow } from "@provence360/content";
import { generateImageVariants, storeImageVariants } from "../processing/variants";
import {
  claimMediaUploadForFinalize,
  markMediaUploadFailed,
  markMediaUploadFinalized,
} from "../repository/media-upload-repository";
import type { ObjectStorage } from "../storage/object-storage";
import { buildOriginalStorageKey } from "./object-keys";
import { validateImageBytes } from "../validation/image-validation";
import { MediaObjectMissingError } from "../errors";

/**
 * Phase 2+3+4+5+6 of the two-phase upload, all in one call (brief's
 * "Upload bytes -> Finalize -> Inspect/Validate -> Process -> Create
 * MediaAsset -> Available" chain): claims the intent (row-locked, one-shot
 * — see `claimMediaUploadForFinalize`), reads the *actually stored* bytes
 * back from `storage`, validates them for real (never trusting the
 * intent's `declaredMimeType`), generates variants, and only then creates
 * the MediaAsset. A MediaAsset is never created before every prior step
 * has succeeded — see ADR 0022, "upload in two phases."
 *
 * Deliberately throws on failure rather than marking the intent `failed`
 * itself: this whole function runs inside one Postgres transaction (`tx`),
 * and a thrown error rolls that transaction back in full — a
 * `markMediaUploadFailed` write issued from *inside* this same rejection
 * path would be undone along with everything else, never actually
 * persisted. See {@link finalizeMediaUploadSafely} for the entry point
 * that gets a "failed" status to actually stick, in its own transaction.
 */
export async function finalizeMediaUpload(
  tx: AppTx,
  storage: ObjectStorage,
  uploadId: string,
): Promise<MediaAssetRow> {
  const tenantId = requireCurrentTenantId();
  const intent = await claimMediaUploadForFinalize(tx, uploadId);

  const bytes = await storage.getObject(intent.storageKey);
  if (!bytes) throw new MediaObjectMissingError(uploadId);

  const validated = await validateImageBytes(bytes, { maxBytes: intent.maxBytes });

  // Storage paths are keyed by a fresh, independent opaque id, not the
  // eventual `media_assets.id` — `createMediaAsset` (packages/content)
  // still owns generating that primary key itself (unchanged since
  // v0.3), so the storage layout can't depend on a value that doesn't
  // exist yet at the point these objects are written.
  const storageId = randomUUID();
  const originalKey = buildOriginalStorageKey(tenantId, storageId);
  await storage.putObject(originalKey, bytes, { contentType: validated.mimeType });

  const resizedVariants = await generateImageVariants(bytes, validated);
  const variants = await storeImageVariants(
    storage,
    tenantId,
    storageId,
    resizedVariants,
    validated.mimeType,
  );

  const asset = await createMediaAsset(tx, {
    kind: "image",
    storageKey: originalKey,
    mimeType: validated.mimeType,
    width: validated.width,
    height: validated.height,
    checksumSha256: validated.checksumSha256,
    byteSize: validated.byteSize,
    variants,
    originalFilename: intent.originalFilename ?? undefined,
  });

  await markMediaUploadFinalized(tx, uploadId, asset.id);
  logger.info("media.upload.finalized", {
    tenantId,
    uploadId,
    mediaAssetId: asset.id,
    byteSize: validated.byteSize,
    format: validated.format,
  });
  return asset;
}

/**
 * The entry point Server Actions/routes should call: runs
 * {@link finalizeMediaUpload} in its own transaction, and — only on
 * failure — issues a *second*, independent transaction to persist
 * `status: "failed"` on the intent, so the Media Library can show "this
 * upload failed" instead of an intent stuck looking `pending` forever.
 * The original error always propagates to the caller either way; marking
 * the intent failed is a best-effort side effect that never masks it (a
 * failure to even write "failed" is logged, not thrown, since the real
 * error is already what the caller needs to see).
 */
export async function finalizeMediaUploadSafely(
  tenantId: string,
  storage: ObjectStorage,
  uploadId: string,
): Promise<MediaAssetRow> {
  try {
    return await withTenantContext(tenantId, (tx) => finalizeMediaUpload(tx, storage, uploadId));
  } catch (error) {
    logger.warn("media.upload.finalize_failed", {
      tenantId,
      uploadId,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await withTenantContext(tenantId, (tx) => markMediaUploadFailed(tx, uploadId));
    } catch (markError) {
      logger.warn("media.upload.mark_failed_error", {
        tenantId,
        uploadId,
        error: markError instanceof Error ? markError.message : String(markError),
      });
    }
    throw error;
  }
}
