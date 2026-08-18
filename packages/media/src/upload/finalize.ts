import { getMediaAsset, createMediaAsset } from "@provence360/content";
import type { AppTx } from "@provence360/database";
import { logger } from "@provence360/observability";
import { requireCurrentTenantId, withTenantContext } from "@provence360/tenant";
import type { MediaAssetRow } from "@provence360/content";
import { generateImageVariants, storeImageVariants } from "../processing/variants";
import {
  claimMediaUploadForFinalize,
  getMediaUploadIntent,
  markMediaUploadFailed,
  markMediaUploadFinalized,
} from "../repository/media-upload-repository";
import type { ObjectStorage } from "../storage/object-storage";
import { buildOriginalStorageKey } from "./object-keys";
import { validateImageBytes } from "../validation/image-validation";
import {
  MediaObjectMissingError,
  MediaStorageUnavailableError,
  MediaUploadAlreadyFinalizedError,
} from "../errors";

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

  const bytes = await getObjectLogged(storage, intent.storageKey, tenantId, uploadId);
  if (!bytes) throw new MediaObjectMissingError(uploadId);

  const validated = await validateImageBytes(bytes, { maxBytes: intent.maxBytes });

  // Storage paths are keyed by the upload intent's own id, not the
  // eventual `media_assets.id` — `createMediaAsset` (packages/content)
  // still owns generating that primary key itself (unchanged since
  // v0.3), so the storage layout can't depend on a value that doesn't
  // exist yet at the point these objects are written. Deliberately the
  // *intent's* id (stable across retries), not a fresh `randomUUID()` per
  // attempt (v0.9's original choice): there is no distributed transaction
  // across Postgres and object storage (brief §5/ADR 0022, "consistency
  // model"), so a finalize that writes these objects successfully and then
  // fails at the `createMediaAsset`/`markMediaUploadFinalized` step (a DB
  // error, a conflict, a crash) always rolls the DB side back to `pending`
  // — but the bytes already written to storage do NOT roll back with it.
  // A fresh random id per attempt would leak an unbounded, never-
  // referenced set of orphaned original+variant objects on every failed
  // retry of a persistently-failing upload; keying by the intent's own
  // (already unique, already tenant-scoped) id instead means every retry
  // overwrites the exact same keys — self-healing, not accumulating. See
  // `finalize.test.ts`'s "storageId is deterministic" case.
  const storageId = intent.id;
  const originalKey = buildOriginalStorageKey(tenantId, storageId);
  await putObjectLogged(storage, originalKey, bytes, validated.mimeType, tenantId, uploadId);

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
 * A storage-layer read/write failure (the bucket unreachable, a network
 * timeout, a permissions error) is a fundamentally different operational
 * event than "the uploaded file failed validation" — the former is
 * infrastructure, actionable by an operator; the latter is routine, user-
 * caused, and expected to happen constantly. Brief §13 asks for
 * `media.storage.put_failed`/`media.storage.get_failed` specifically so
 * the two are grep-able apart in production logs. Always rethrows the
 * original error unchanged — this only adds a log line, never changes
 * behavior.
 */
async function getObjectLogged(
  storage: ObjectStorage,
  key: string,
  tenantId: string,
  uploadId: string,
): Promise<Buffer | null> {
  try {
    return await storage.getObject(key);
  } catch (error) {
    logger.warn("media.storage.get_failed", {
      tenantId,
      uploadId,
      error: error instanceof Error ? error.message : String(error),
    });
    // The raw error (an SDK/network exception) is logged above, in full,
    // server-side — never rethrown as-is (brief §14). A caller only ever
    // sees the closed, generic {@link MediaStorageUnavailableError}.
    throw new MediaStorageUnavailableError();
  }
}

async function putObjectLogged(
  storage: ObjectStorage,
  key: string,
  body: Buffer,
  contentType: string,
  tenantId: string,
  uploadId: string,
): Promise<void> {
  try {
    await storage.putObject(key, body, { contentType });
  } catch (error) {
    logger.warn("media.storage.put_failed", {
      tenantId,
      uploadId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new MediaStorageUnavailableError();
  }
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
 *
 * Retry-after-success (brief §5B) is handled explicitly here, not left as
 * an error the caller must special-case: if the client's connection dies
 * *after* `finalizeMediaUpload` committed but *before* the response ever
 * reached them, their only sane move is to call this again with the same
 * `uploadId`. `finalizeMediaUpload` itself would throw
 * {@link MediaUploadAlreadyFinalizedError} for that (the row's no longer
 * `pending` — see `claimMediaUploadForFinalize`), which is the *correct*
 * signal for a genuinely *different* re-finalize attempt (the upload
 * failed or expired, or something else already claimed it) but the
 * *wrong* one for this specific case: the caller asked for the same
 * result they already (unknowingly) got, and the safe, idempotent answer
 * is to hand them that same {@link MediaAssetRow} back, not an error. Only
 * a `finalized` intent with its `mediaAssetId` actually resolving gets
 * this treatment; `failed`/`expired` still throw, and always did — a
 * retry cannot succeed there because there is no result to hand back.
 *
 * On success, also deletes the upload intent's own *temporary* storage
 * object (its `media_uploads.storage_key`, distinct from the MediaAsset's
 * own `original`/variant keys `finalizeMediaUpload` just wrote) — brief
 * §6/§7: those bytes were only ever a staging copy, and once a
 * MediaAsset exists referencing its own independently-stored original,
 * the temp copy is pure waste that would otherwise sit unreferenced
 * forever (only an expired-`pending` or `failed` intent's temp object was
 * ever reclaimed before this). Deliberately done *after* the transaction
 * that creates the MediaAsset has already committed, never inside it or
 * before it: deleting first and having the DB step fail would destroy the
 * client's only uploaded copy with nothing to roll it back to (there is no
 * distributed transaction across Postgres and object storage — see the
 * `storageId` comment above). Best-effort and logged, not thrown: a
 * successful finalize must never fail the caller's request over a cleanup
 * step that failed after the actual result already exists.
 */
export async function finalizeMediaUploadSafely(
  tenantId: string,
  storage: ObjectStorage,
  uploadId: string,
): Promise<MediaAssetRow> {
  try {
    const asset = await withTenantContext(tenantId, (tx) =>
      finalizeMediaUpload(tx, storage, uploadId),
    );
    await bestEffortDeleteTempUploadObject(tenantId, storage, uploadId);
    return asset;
  } catch (error) {
    if (error instanceof MediaUploadAlreadyFinalizedError) {
      const existing = await tryResolveAlreadyFinalizedAsset(tenantId, uploadId);
      if (existing) {
        logger.info("media.upload.finalize_retry_after_success", {
          tenantId,
          uploadId,
          mediaAssetId: existing.id,
        });
        return existing;
      }
    }
    logger.warn("media.upload.finalize_failed", {
      tenantId,
      uploadId,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await withTenantContext(tenantId, (tx) => markMediaUploadFailed(tx, uploadId));
      await bestEffortDeleteTempUploadObject(tenantId, storage, uploadId);
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

/**
 * Only reached from the `MediaUploadAlreadyFinalizedError` branch above —
 * confirms this specific "already finalized" is a genuine retry-after-
 * success (a `finalized` row whose `mediaAssetId` still resolves to a real
 * MediaAsset), as opposed to a `failed`/`expired` intent that also throws
 * the same error type. Returns `null` for anything short of that exact
 * case, which sends the caller back to the normal failure path — never
 * throws itself, so a transient error *here* can't mask the original
 * error the caller actually needs to see.
 */
async function tryResolveAlreadyFinalizedAsset(
  tenantId: string,
  uploadId: string,
): Promise<MediaAssetRow | null> {
  try {
    return await withTenantContext(tenantId, async (tx) => {
      const intent = await getMediaUploadIntent(tx, uploadId);
      if (intent.status !== "finalized" || !intent.mediaAssetId) return null;
      return (await getMediaAsset(tx, intent.mediaAssetId)) ?? null;
    });
  } catch {
    return null;
  }
}

/**
 * Best-effort deletion of an upload intent's own *temporary* storage
 * object — called from both `finalizeMediaUploadSafely`'s success path
 * (the temp copy is now redundant; see that function's own doc comment)
 * and its failure path (a `failed` intent is exactly as done-with as an
 * expired one — see `cleanupExpiredMediaUploads` — but until this version
 * only the periodic expiry sweep ever reclaimed a temp object; a
 * synchronously-failed finalize left its temp object leaked forever).
 * Deleting an already-absent key is a no-op for every `ObjectStorage`
 * implementation, so this is safe to attempt unconditionally. Never
 * allowed to throw past this point — a failure here must never mask the
 * real result (or error) the caller is already receiving.
 */
async function bestEffortDeleteTempUploadObject(
  tenantId: string,
  storage: ObjectStorage,
  uploadId: string,
): Promise<void> {
  try {
    const intent = await withTenantContext(tenantId, (tx) => getMediaUploadIntent(tx, uploadId));
    await storage.deleteObject(intent.storageKey);
  } catch (cleanupError) {
    logger.warn("media.upload.temp_object_cleanup_error", {
      tenantId,
      uploadId,
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    });
  }
}
