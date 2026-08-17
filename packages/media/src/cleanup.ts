import type { AppTx } from "@provence360/database";
import { logger } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import {
  expireOverdueMediaUploads,
  listExpiredPendingMediaUploads,
} from "./repository/media-upload-repository";
import type { ObjectStorage } from "./storage/object-storage";

/**
 * Deterministic, idempotent cleanup for abandoned uploads (brief §26): a
 * still-`pending` intent past its TTL never became a MediaAsset and never
 * will (see `claimMediaUploadForFinalize`'s own expiry check) — its
 * temporary storage object is deleted and the row is marked `expired`.
 * Safe to call repeatedly or concurrently: `expireOverdueMediaUploads`'s
 * `UPDATE ... WHERE status = 'pending'` only ever matches a row once, and
 * deleting an already-absent storage object is a no-op for every
 * `ObjectStorage` implementation.
 *
 * Not wired to a scheduler in v0.9 (brief: "il n'est pas nécessaire de
 * construire un scheduler complexe") — this is the callable primitive a
 * cron job, a worker tick, or a manual admin action can invoke. See
 * docs/adr/0022-media-ingestion-asset-delivery.md for how it's meant to
 * be run in production.
 */
export async function cleanupExpiredMediaUploads(
  tx: AppTx,
  storage: ObjectStorage,
): Promise<{ expiredCount: number }> {
  const tenantId = requireCurrentTenantId();
  const expiring = await listExpiredPendingMediaUploads(tx);
  for (const upload of expiring) {
    await storage.deleteObject(upload.storageKey);
  }
  const expiredCount = await expireOverdueMediaUploads(tx);
  if (expiredCount > 0) {
    logger.info("media.upload.cleanup", { tenantId, expiredCount });
  }
  return { expiredCount };
}
