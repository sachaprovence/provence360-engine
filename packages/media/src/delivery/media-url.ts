import type { ImageVariantToken } from "../domain/constants";
import type { MediaVariantsV1 } from "../domain/media-variants";

export type DeliveryVariant = ImageVariantToken | "original";

/**
 * A stable, cacheable, same-origin URL for a MediaAsset's rendered bytes
 * (brief §13). `fingerprint` (the asset's own SHA-256 checksum) makes
 * different content always resolve to a different URL — the property
 * that lets `Cache-Control: immutable` be genuinely true rather than a
 * lie the browser is asked to trust (see ADR 0022, "cache strategy").
 * Deliberately not a signed/expiring URL: nothing about a public site's
 * images needs authentication, and a snapshot must never freeze a value
 * that expires.
 */
export function buildMediaDeliveryUrl(
  assetId: string,
  fingerprint: string,
  variant: DeliveryVariant,
): string {
  return `/media/${assetId}/${fingerprint}/${variant}`;
}

export interface DeliverableAsset {
  id: string;
  storageKey: string;
  checksumSha256?: string | null;
  variants?: MediaVariantsV1 | null;
}

/**
 * Resolves which actual storage key a requested variant maps to for a
 * given asset — `"original"` (or any variant that was never generated,
 * e.g. the source was already narrower than that variant's target width)
 * falls back to the asset's own `storageKey`. This is the one place that
 * decision is made, shared by the delivery route and anything that needs
 * to know "what will actually be served" without duplicating the fallback
 * logic.
 */
export function resolveDeliveryStorageKey(
  asset: DeliverableAsset,
  variant: DeliveryVariant,
): string {
  if (variant === "original") return asset.storageKey;
  const entry = asset.variants?.[variant];
  return entry?.storageKey ?? asset.storageKey;
}
