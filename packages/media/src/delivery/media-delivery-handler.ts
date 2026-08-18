import { getMediaAsset } from "@provence360/content";
import type { AppTx } from "@provence360/database";
import { logger } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import { resolveMediaVariants } from "../domain/media-variants";
import {
  resolveDeliveryStorageKey,
  type DeliverableAsset,
  type DeliveryVariant,
} from "./media-url";
import type { ObjectStorage } from "../storage/object-storage";

export interface MediaDeliveryResult {
  body: Buffer;
  contentType: string;
  /** True only for a genuinely content-addressed URL (asset has a real checksum) — the caller decides the Cache-Control value from this. */
  immutable: boolean;
  /**
   * A strong validator (brief §9) for this exact response — the asset's
   * own fingerprint plus the requested variant, so a thumbnail and its
   * original never collide on the same ETag despite sharing an asset id.
   * Unquoted; callers wrap it in `"..."` themselves when setting the
   * actual `ETag` header (see `buildMediaDeliveryResponse`).
   */
  etag: string;
}

/**
 * Resolves `/media/{assetId}/{fingerprint}/{variant}` against the
 * current tenant context and streams the right bytes back — the one
 * place both `apps/web`'s public route and `apps/admin`'s Preview route
 * share this logic, so "what does this URL actually serve" has exactly
 * one implementation (brief §15: Preview and Public must share the same
 * primitives). Returns `null` for any mismatch — wrong id, wrong
 * fingerprint, wrong tenant (via RLS), or a storage object that's since
 * disappeared — the caller turns that into a 404, never a distinguishing
 * error message (see ADR 0022, "media delivery").
 *
 * The fingerprint isn't just decorative: this function refuses to serve
 * anything unless the *requested* fingerprint matches the asset's own
 * stored `checksumSha256` exactly — an old/wrong fingerprint 404s instead
 * of quietly serving today's (different) bytes under yesterday's URL,
 * which is what makes `Cache-Control: immutable` an honest promise.
 */
export async function resolveMediaDelivery(
  tx: AppTx,
  storage: ObjectStorage,
  assetId: string,
  fingerprint: string,
  variant: DeliveryVariant,
): Promise<MediaDeliveryResult | null> {
  const tenantId = requireCurrentTenantId();

  const asset = await getMediaAsset(tx, assetId);
  if (!asset) return notFound(tenantId, assetId, variant, "asset_not_found");

  // The fingerprint identifies *this version* of the asset as a whole —
  // the same value gates every variant, including "original" — so a
  // stale/forged fingerprint never resolves to any bytes, and a real
  // content change (a genuinely new upload; see ADR 0022, "immutability
  // of the binary" — a replaced file is always a *new* MediaAsset with
  // its own id, so this checksum never actually changes in place) can
  // never be masked by a cached, differently-fingerprinted URL.
  if (!asset.checksumSha256 || asset.checksumSha256 !== fingerprint) {
    return notFound(tenantId, assetId, variant, "fingerprint_mismatch");
  }

  const deliverable: DeliverableAsset = {
    id: asset.id,
    storageKey: asset.storageKey,
    checksumSha256: asset.checksumSha256,
    variants: resolveMediaVariants(asset.variants),
  };

  const storageKey = resolveDeliveryStorageKey(deliverable, variant);
  const body = await storage.getObject(storageKey);
  if (!body) return notFound(tenantId, assetId, variant, "storage_object_missing");

  return {
    body,
    contentType: asset.mimeType,
    immutable: Boolean(asset.checksumSha256),
    etag: `${asset.checksumSha256}-${variant}`,
  };
}

/**
 * `media.delivery.not_found` (brief §13) — logged at `info`, not `warn`:
 * this route is public and unauthenticated, so a 404 here is routine
 * (stale bookmarks, forged/probing requests, a since-deleted asset) far
 * more often than it's an actionable problem. `reason` still distinguishes
 * the one case worth watching in aggregate — `storage_object_missing` is
 * exactly the DB-orphan symptom `findDbOrphans` also detects proactively
 * (see `reconciliation/orphan-scan.ts`); seeing it show up *live*, from a
 * real visitor, is a genuinely useful signal a dashboard could alert on.
 * Never logs the fingerprint itself (an opaque value, not sensitive, but
 * unnecessary) or anything from the request beyond these ids.
 */
function notFound(
  tenantId: string,
  assetId: string,
  variant: DeliveryVariant,
  reason: "asset_not_found" | "fingerprint_mismatch" | "storage_object_missing",
): null {
  logger.info("media.delivery.not_found", { tenantId, assetId, variant, reason });
  return null;
}
