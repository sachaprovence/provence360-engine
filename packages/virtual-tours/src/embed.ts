import { UnknownVirtualTourProviderError } from "./errors";
import { virtualTourProviderRegistry } from "./provider-registry";

/**
 * Everything a block renderer needs to draw a VirtualTour, and nothing
 * else (section 29 of the brief) — never the raw DB row, never an
 * internal name, never anything the renderer could turn into an
 * uncontrolled `<iframe src>`. `src` is always the provider adapter's own
 * deterministic, first-party-constructed URL; the renderer never
 * reconstructs provider-specific rules itself.
 */
export interface SafeVirtualTourEmbed {
  provider: string;
  src: string;
  publicUrl?: string;
  allowFullscreen: boolean;
  /** Passed through verbatim to the rendered `<iframe allow="...">` — see {@link VirtualTourProviderDefinition.capabilities}'s `iframeAllow` doc comment. */
  iframeAllow?: string;
}

/**
 * The one place a `virtual_tours` row's `provider`/`providerAssetId`
 * becomes an embeddable descriptor. Throws `UnknownVirtualTourProviderError`
 * if the stored `provider` somehow isn't registered (should only happen if
 * a row predates a provider's removal — a defensive check, not an
 * expected runtime path) and `InvalidVirtualTourProviderInputError`-shaped
 * failure is avoided entirely here since `providerAssetId` was already
 * normalized at write time; callers that want a re-validation pass (e.g.
 * publish-time) should call the provider's own `validateExternalId`
 * directly instead of relying on this function to fail loudly.
 */
export function buildSafeVirtualTourEmbed(tour: {
  provider: string;
  providerAssetId: string;
}): SafeVirtualTourEmbed {
  const definition = virtualTourProviderRegistry.get(tour.provider);
  if (!definition) throw new UnknownVirtualTourProviderError(tour.provider);

  return {
    provider: definition.provider,
    src: definition.buildEmbedUrl(tour.providerAssetId),
    ...(definition.buildPublicUrl
      ? { publicUrl: definition.buildPublicUrl(tour.providerAssetId) }
      : {}),
    allowFullscreen: definition.capabilities.allowFullscreen,
    ...(definition.capabilities.iframeAllow
      ? { iframeAllow: definition.capabilities.iframeAllow }
      : {}),
  };
}

/** Every registered provider's `frameOrigins`, deduplicated — the single source of truth `next.config.mjs`'s CSP `frame-src` list must match (see `docs/adr/0019-virtual-tour-immersive-kernel.md`). */
export function listAllProviderFrameOrigins(): readonly string[] {
  return [...new Set(virtualTourProviderRegistry.list().flatMap((p) => p.frameOrigins))];
}
