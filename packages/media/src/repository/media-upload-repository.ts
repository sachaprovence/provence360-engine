import { and, eq, lt, sql } from "drizzle-orm";
import type { AppTx } from "@provence360/database";
import { mediaUploads } from "@provence360/database";
import { logger } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import { UPLOAD_INTENT_TTL_MS } from "../domain/constants";
import {
  MediaUploadAlreadyFinalizedError,
  MediaUploadExpiredError,
  MediaUploadNotFoundError,
} from "../errors";
import { buildUploadStorageKey } from "../upload/object-keys";

export interface CreateMediaUploadIntentInput {
  maxBytes: number;
  declaredMimeType?: string | undefined;
  originalFilename?: string | undefined;
  createdByUserId?: string | undefined;
}

export type MediaUploadRow = typeof mediaUploads.$inferSelect;

/** Phase 1 of the two-phase upload: a short-lived, one-shot claim on an opaque, server-generated storage key. */
export async function createMediaUploadIntent(
  tx: AppTx,
  input: CreateMediaUploadIntentInput,
): Promise<MediaUploadRow> {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .insert(mediaUploads)
    .values({
      tenantId,
      storageKey: buildUploadStorageKey(tenantId),
      maxBytes: input.maxBytes,
      declaredMimeType: input.declaredMimeType,
      originalFilename: input.originalFilename,
      createdByUserId: input.createdByUserId,
      expiresAt: new Date(Date.now() + UPLOAD_INTENT_TTL_MS),
    })
    .returning();
  if (!row) throw new Error("Failed to create media upload intent");
  logger.info("media.upload.intent_created", {
    tenantId,
    uploadId: row.id,
    maxBytes: row.maxBytes,
  });
  return row;
}

export async function getMediaUploadIntent(tx: AppTx, id: string): Promise<MediaUploadRow> {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .select()
    .from(mediaUploads)
    .where(and(eq(mediaUploads.id, id), eq(mediaUploads.tenantId, tenantId)));
  if (!row) throw new MediaUploadNotFoundError(id);
  return row;
}

/**
 * Row-locks and atomically claims a pending intent for finalization — the
 * same `SELECT ... FOR UPDATE` pattern `publishSite` already uses to
 * serialize concurrent writers on one row (see
 * `packages/publishing/src/publish-revision.ts`). Two concurrent
 * `finalizeMediaUpload` calls for the same upload id serialize here: the
 * second blocks until the first's transaction commits, then observes
 * `status !== "pending"` and throws — never two MediaAssets from one
 * intent. Callers run this inside the same transaction they'll use for
 * every subsequent step (storage read, validation, MediaAsset creation,
 * the row's own final UPDATE), so the lock covers the whole finalize.
 */
export async function claimMediaUploadForFinalize(tx: AppTx, id: string): Promise<MediaUploadRow> {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .select()
    .from(mediaUploads)
    .where(and(eq(mediaUploads.id, id), eq(mediaUploads.tenantId, tenantId)))
    .for("update");
  if (!row) throw new MediaUploadNotFoundError(id);
  if (row.status !== "pending") throw new MediaUploadAlreadyFinalizedError(id);
  if (row.expiresAt.getTime() < Date.now()) throw new MediaUploadExpiredError(id);
  return row;
}

export async function markMediaUploadFinalized(
  tx: AppTx,
  id: string,
  mediaAssetId: string,
): Promise<void> {
  const tenantId = requireCurrentTenantId();
  await tx
    .update(mediaUploads)
    .set({ status: "finalized", mediaAssetId, finalizedAt: new Date() })
    .where(and(eq(mediaUploads.id, id), eq(mediaUploads.tenantId, tenantId)));
}

export async function markMediaUploadFailed(tx: AppTx, id: string): Promise<void> {
  const tenantId = requireCurrentTenantId();
  await tx
    .update(mediaUploads)
    .set({ status: "failed" })
    .where(and(eq(mediaUploads.id, id), eq(mediaUploads.tenantId, tenantId)));
}

/**
 * Every `media_uploads.storage_key` for the current tenant, regardless of
 * status — the "accounted for" half of storage-orphan reconciliation
 * (`findStorageOrphans`): a temp upload object is never a mystery as long
 * as its owning row still exists, whatever that row's status is (even a
 * `finalized`/`failed` row whose temp object *should* already be deleted
 * by now — see `finalizeMediaUploadSafely` — legitimately explains that
 * key if the delete itself hasn't happened yet or failed).
 */
export async function listAllMediaUploadStorageKeys(tx: AppTx): Promise<string[]> {
  const tenantId = requireCurrentTenantId();
  const rows = await tx
    .select({ storageKey: mediaUploads.storageKey })
    .from(mediaUploads)
    .where(eq(mediaUploads.tenantId, tenantId));
  return rows.map((row) => row.storageKey);
}

/** Every still-`pending` intent whose TTL has passed — the read half of `cleanupExpiredMediaUploads`. */
export async function listExpiredPendingMediaUploads(tx: AppTx): Promise<MediaUploadRow[]> {
  const tenantId = requireCurrentTenantId();
  return tx
    .select()
    .from(mediaUploads)
    .where(
      and(
        eq(mediaUploads.tenantId, tenantId),
        eq(mediaUploads.status, "pending"),
        lt(mediaUploads.expiresAt, sql`now()`),
      ),
    );
}

/** Idempotent: marks every currently-expired pending intent as `expired` in one statement. Safe to call concurrently — an already-transitioned row is simply not matched again. */
export async function expireOverdueMediaUploads(tx: AppTx): Promise<number> {
  const tenantId = requireCurrentTenantId();
  const rows = await tx
    .update(mediaUploads)
    .set({ status: "expired" })
    .where(
      and(
        eq(mediaUploads.tenantId, tenantId),
        eq(mediaUploads.status, "pending"),
        lt(mediaUploads.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: mediaUploads.id });
  return rows.length;
}
