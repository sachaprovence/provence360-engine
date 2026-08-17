import type { FrozenMediaDescriptor, FrozenMediaVariants } from "./render-context";

export type DeliveryVariant = "thumbnail" | "small" | "medium" | "large" | "original";

// v0.9 — Media Ingestion, Asset Lifecycle & Delivery Kernel (see
// docs/adr/0022-media-ingestion-asset-delivery.md). A small, local
// re-implementation of `@provence360/media`'s own `buildMediaDeliveryUrl`/
// `resolveDeliveryStorageKey` — deliberately not imported: `packages/media`
// depends on `@provence360/database` (for the upload-intent repository),
// and `packages/renderer` intentionally stays free of any dependency that
// could pull database/storage machinery into its own module graph (the
// same reasoning `FrozenMediaDescriptor` itself is declared locally for,
// see that type's own doc comment). This logic is a handful of lines with
// no independent behavior worth a shared package for.

/** A stable, cacheable, same-origin URL — see ADR 0022, "media delivery." */
export function buildMediaDeliveryUrl(
  assetId: string,
  fingerprint: string,
  variant: DeliveryVariant,
): string {
  return `/media/${assetId}/${fingerprint}/${variant}`;
}

function resolveVariantEntry(
  variants: FrozenMediaVariants | null | undefined,
  variant: DeliveryVariant,
) {
  if (variant === "original") return undefined;
  return variants?.[variant];
}

export interface ResolvedResponsiveImage {
  src: string;
  width: number | null;
  height: number | null;
  /** Present only when the asset has a fingerprint and at least one real, narrower variant — a `srcset` candidate string ready for an `<img>`. */
  srcSet?: string;
}

/**
 * Resolves a `FrozenMediaDescriptor` into what an `<img>` tag actually
 * needs: a same-origin `src` (the largest available variant, or the
 * original if none were ever generated — see brief §16), its real
 * width/height (for zero-CLS rendering), and an optional `srcset` letting
 * the browser pick a narrower variant on a small viewport. Falls back
 * cleanly to the raw `storageKey` when the asset has no `checksumSha256`
 * (a pre-v0.9/legacy asset, or a test fixture) — the delivery route isn't
 * involved at all in that case, exactly today's pre-v0.9 behavior.
 */
export function resolveResponsiveImage(descriptor: FrozenMediaDescriptor): ResolvedResponsiveImage {
  if (!descriptor.checksumSha256) {
    return { src: descriptor.storageKey, width: descriptor.width, height: descriptor.height };
  }

  const variants = descriptor.variants;
  const candidates: { variant: DeliveryVariant; width: number; height: number }[] = [];
  for (const variant of ["thumbnail", "small", "medium", "large"] as const) {
    const entry = resolveVariantEntry(variants, variant);
    if (entry) candidates.push({ variant, width: entry.width, height: entry.height });
  }

  const largest = candidates.at(-1);
  const chosen = largest ?? {
    variant: "original" as const,
    width: descriptor.width ?? 0,
    height: descriptor.height ?? 0,
  };

  const src = buildMediaDeliveryUrl(descriptor.id, descriptor.checksumSha256, chosen.variant);
  const srcSetEntries = [
    ...candidates.map(
      (c) =>
        `${buildMediaDeliveryUrl(descriptor.id, descriptor.checksumSha256 as string, c.variant)} ${c.width}w`,
    ),
  ];
  if (descriptor.width) {
    srcSetEntries.push(
      `${buildMediaDeliveryUrl(descriptor.id, descriptor.checksumSha256, "original")} ${descriptor.width}w`,
    );
  }

  return {
    src,
    width: chosen.width || descriptor.width,
    height: chosen.height || descriptor.height,
    ...(srcSetEntries.length > 1 ? { srcSet: srcSetEntries.join(", ") } : {}),
  };
}
