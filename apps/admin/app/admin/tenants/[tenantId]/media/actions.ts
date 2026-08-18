"use server";

import { revalidatePath } from "next/cache";
import { updateMediaAssetAltText } from "@provence360/content";
import {
  MAX_UPLOAD_BYTES,
  createMediaUploadIntent,
  finalizeMediaUploadSafely,
  getObjectStorage,
} from "@provence360/media";
import { withTenantPage } from "@/lib/actor";

export interface UploadMediaFormState {
  error?: string;
}

const FRIENDLY_ERROR_NAMES = new Set([
  "MediaTypeRejectedError",
  "MediaTooLargeError",
  "MediaDecodeError",
  "MediaObjectMissingError",
  "MediaStorageUnavailableError",
]);

/**
 * The Server Action behind `MediaUploadForm` — implements the two-phase
 * upload's phases 1+2 itself (create intent, write the actually-received
 * bytes to storage), then delegates phases 3-6 (inspect/validate/process/
 * create MediaAsset) to `finalizeMediaUploadSafely` (see ADR 0022).
 *
 * Deliberately two separate authorization-scoped steps rather than one
 * `withTenantPage` call wrapping everything: `withTenantPage` opens a
 * single Postgres transaction, and `finalizeMediaUploadSafely` needs its
 * *own* transaction(s) to be able to durably mark a failed upload "failed"
 * (see `packages/media/src/upload/finalize.ts`'s doc comment on why a
 * single enclosing transaction can't do that). Splitting them here mirrors
 * that same reasoning: the intent is created and committed first (under a
 * `media.create`-checked transaction), then finalize runs independently
 * with the plain `tenantId` already authorized in the first step.
 */
export async function uploadMediaAction(
  tenantId: string,
  _prevState: UploadMediaFormState,
  formData: FormData,
): Promise<UploadMediaFormState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `File is too large (max ${String(MAX_UPLOAD_BYTES / (1024 * 1024))} MiB).` };
  }

  const altTextRaw = formData.get("altText");
  const altText =
    typeof altTextRaw === "string" && altTextRaw.trim() ? altTextRaw.trim() : undefined;

  const storage = getObjectStorage();
  const bytes = Buffer.from(await file.arrayBuffer());

  let uploadId: string;
  let storageKey: string;
  try {
    const intent = await withTenantPage(tenantId, "media.create", (tx, actor) =>
      createMediaUploadIntent(tx, {
        maxBytes: MAX_UPLOAD_BYTES,
        declaredMimeType: file.type || undefined,
        originalFilename: file.name || undefined,
        createdByUserId: actor.userId,
      }),
    );
    uploadId = intent.id;
    storageKey = intent.storageKey;
  } catch (error) {
    if (error instanceof Error) return { error: error.message };
    throw error;
  }

  // Never client-declared: this is the server's own idea of the upload's
  // content type, from the multipart part the runtime itself parsed —
  // still just a hint for storage metadata, not a trust boundary.
  // `finalizeMediaUploadSafely` below is what actually decodes and
  // validates the bytes for real.
  await storage.putObject(storageKey, bytes, {
    contentType: file.type || "application/octet-stream",
  });

  try {
    const asset = await finalizeMediaUploadSafely(tenantId, storage, uploadId);
    if (altText) {
      // altText is intrinsic MediaAsset metadata (brief §19) — set once,
      // at upload time, from this same form; there is no separate
      // contextual-alt-text editorial system in v0.9 (documented
      // decision, see ADR 0022 and docs/MEDIA.md).
      await withTenantPage(tenantId, "media.create", (tx) =>
        updateMediaAssetAltText(tx, asset.id, altText),
      );
    }
  } catch (error) {
    if (error instanceof Error && FRIENDLY_ERROR_NAMES.has(error.name)) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/admin/tenants/${tenantId}/media`);
  return {};
}
