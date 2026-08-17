import type { MediaAssetRow } from "@provence360/content";
import { buildMediaDeliveryUrl, resolveMediaVariants } from "@provence360/media";

// v0.9 — Media Ingestion, Asset Lifecycle & Delivery Kernel (see
// docs/adr/0022-media-ingestion-asset-delivery.md). Server-only: this file
// imports `@provence360/media`, which pulls in `sharp`/`@aws-sdk/client-s3`/
// `@provence360/database` — exactly the module graph that must never reach
// a Client Component's browser bundle (the same reason
// `packages/renderer`/`packages/publishing` don't depend on
// `@provence360/media` either, see docs/ARCHITECTURE.md). Every Server
// Component page below resolves the plain, already-computed URLs here and
// passes them as props to Client Components (`MediaPicker`,
// `MediaUploadForm`) — those never import this module or
// `@provence360/media` themselves.
export interface MediaThumbnailInfo {
  id: string;
  /** A same-origin Admin Preview delivery URL, or "" when no v0.9 fingerprint/variant exists yet (legacy/non-image asset — the grid falls back to a placeholder). */
  previewUrl: string;
  kind: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string | null;
  originalFilename: string | null;
  byteSize: number | null;
  createdAt: Date;
}

/**
 * Resolves an Admin-only preview URL for a MediaAsset row — deliberately
 * separate from `packages/renderer`'s `resolveResponsiveImage`, which
 * works off a *frozen* `FrozenMediaDescriptor` from a published Revision,
 * not a live row. Prefers the "thumbnail" variant (cheapest to transfer for
 * a grid of many assets); falls back to "original" when no thumbnail was
 * generated (a source narrower than 320px, or a legacy asset with a
 * checksum but no variants). No checksum at all (pre-v0.9/seed row, or a
 * non-image kind) -> "" — the caller renders a placeholder instead of a
 * broken `<img>`.
 */
export function resolveMediaThumbnail(asset: MediaAssetRow): MediaThumbnailInfo {
  const variants = resolveMediaVariants(asset.variants);
  const previewUrl =
    asset.kind === "image" && asset.checksumSha256
      ? buildMediaDeliveryUrl(
          asset.id,
          asset.checksumSha256,
          variants?.thumbnail ? "thumbnail" : "original",
        )
      : "";
  return {
    id: asset.id,
    previewUrl,
    kind: asset.kind,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    altText: asset.altText,
    originalFilename: asset.originalFilename,
    byteSize: asset.byteSize,
    createdAt: asset.createdAt,
  };
}
