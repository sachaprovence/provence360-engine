import { randomUUID } from "node:crypto";

/**
 * Server-generated, opaque storage keys — a client never supplies or
 * influences any part of this string (brief §5). `tenantId` is always the
 * server's own `requireCurrentTenantId()` value, never a client-provided
 * one, so one tenant can never construct a key that collides with (or
 * reads) another's. The uuid segment makes collisions practically
 * impossible without depending on any client-supplied name.
 *
 * The uploaded file's own filename is *never* part of this key — see
 * `media_assets.originalFilename`/`media_uploads.originalFilename`, kept
 * purely as separate, informative metadata.
 */
export function buildUploadStorageKey(tenantId: string): string {
  return `tenants/${tenantId}/media/uploads/${randomUUID()}`;
}

/** The finalized original's own key — distinct from the upload's temporary key, both opaque. */
export function buildOriginalStorageKey(tenantId: string, mediaAssetId: string): string {
  return `tenants/${tenantId}/media/${mediaAssetId}/original`;
}

export function buildVariantStorageKey(
  tenantId: string,
  mediaAssetId: string,
  variant: string,
): string {
  return `tenants/${tenantId}/media/${mediaAssetId}/${variant}`;
}
