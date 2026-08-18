import { listMediaAssets } from "@provence360/content";
import type { AppTx } from "@provence360/database";
import { logger } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import { resolveMediaVariants } from "../domain/media-variants";
import { listAllMediaUploadStorageKeys } from "../repository/media-upload-repository";
import type { ObjectStorage } from "../storage/object-storage";

/**
 * Orphan reconciliation (brief §7) — two distinct, asymmetric problems,
 * never conflated:
 *
 *  - A **storage orphan**: an object present in storage that no row (a
 *    MediaAsset's own key or variant, or a still-tracked upload's temp
 *    key) explains. Detected by {@link findStorageOrphans}.
 *  - A **DB orphan**: a MediaAsset row (or one of its declared variants)
 *    whose storage object is missing — the row's promise ("this bytes
 *    exist") is broken. Detected by {@link findDbOrphans}.
 *
 * Both are strictly *detection* — neither function deletes or repairs
 * anything. The brief is explicit that "looks orphaned" is not sufficient
 * grounds to delete: prefer detect -> report -> classify -> a human or a
 * separate, deliberate cleanup step decides what to do next. Nothing here
 * is wired to a scheduler, same as `cleanupExpiredMediaUploads` — these
 * are callable operational primitives, not an automated system.
 */

export interface StorageOrphan {
  storageKey: string;
}

/**
 * Every object under this tenant's `tenants/{tenantId}/media/` prefix that
 * no known row explains — neither a MediaAsset's `storageKey`/variant
 * entries, nor any `media_uploads` row's own temp `storageKey` (any
 * status: even a `finalized`/`failed` row whose temp object should
 * already be gone still *explains* that key if the delete hasn't
 * happened yet — see `finalizeMediaUploadSafely`). A key showing up here
 * has no explanation in the database at all — the strongest, safest
 * definition of "orphan" this system can compute without guessing.
 *
 * Never auto-deletes anything — see this module's own doc comment.
 */
export async function findStorageOrphans(
  tx: AppTx,
  storage: ObjectStorage,
): Promise<StorageOrphan[]> {
  const tenantId = requireCurrentTenantId();
  const prefix = `tenants/${tenantId}/media/`;

  const [allKeys, assets, uploadKeys] = await Promise.all([
    storage.listObjects(prefix),
    listMediaAssets(tx),
    listAllMediaUploadStorageKeys(tx),
  ]);

  const referenced = new Set<string>(uploadKeys);
  for (const asset of assets) {
    referenced.add(asset.storageKey);
    const variants = resolveMediaVariants(asset.variants);
    if (!variants) continue;
    for (const entry of Object.values(variants)) {
      if (entry && typeof entry === "object" && "storageKey" in entry) {
        referenced.add(entry.storageKey);
      }
    }
  }

  const orphans = allKeys
    .filter((key) => !referenced.has(key))
    .map((storageKey) => ({ storageKey }));

  if (orphans.length > 0) {
    logger.warn("media.reconciliation.storage_orphans_found", {
      tenantId,
      count: orphans.length,
    });
  }
  return orphans;
}

export type DbOrphanKind = string;

export interface DbOrphan {
  mediaAssetId: string;
  storageKey: string;
  /** "original" for the asset's own row, or the variant token (e.g. "thumbnail") otherwise. */
  kind: DbOrphanKind;
}

/**
 * Every MediaAsset (or declared variant) whose storage object is missing
 * — a broken promise the delivery route will silently 404 on the moment a
 * visitor requests it, discovered here proactively instead. Uses
 * `headObject` (metadata only, no body transfer) — checking N assets is
 * N cheap existence checks, never N full downloads.
 */
export async function findDbOrphans(tx: AppTx, storage: ObjectStorage): Promise<DbOrphan[]> {
  const tenantId = requireCurrentTenantId();
  const assets = await listMediaAssets(tx);
  const orphans: DbOrphan[] = [];

  for (const asset of assets) {
    const originalMeta = await storage.headObject(asset.storageKey);
    if (!originalMeta) {
      orphans.push({ mediaAssetId: asset.id, storageKey: asset.storageKey, kind: "original" });
    }

    const variants = resolveMediaVariants(asset.variants);
    if (!variants) continue;
    for (const [token, entry] of Object.entries(variants)) {
      if (!entry || typeof entry !== "object" || !("storageKey" in entry)) continue;
      const meta = await storage.headObject(entry.storageKey);
      if (!meta) {
        orphans.push({ mediaAssetId: asset.id, storageKey: entry.storageKey, kind: token });
      }
    }
  }

  if (orphans.length > 0) {
    logger.warn("media.reconciliation.db_orphans_found", { tenantId, count: orphans.length });
  }
  return orphans;
}
