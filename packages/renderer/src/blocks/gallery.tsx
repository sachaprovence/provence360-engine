import type { GalleryProps } from "@provence360/content";
import { resolveLocalizedString } from "@provence360/content";
import type { BlockRenderer } from "../block-renderer-registry";
import { resolveMediaDescriptors } from "../resolve-media";
import { resolveResponsiveImage } from "../resolve-delivery-url";

export const galleryRendererV1: BlockRenderer<GalleryProps> = async ({ id, props, context }) => {
  const t = context.tokens;
  const caption = props.caption
    ? resolveLocalizedString(props.caption, context.locale, context.defaultLocale)
    : undefined;

  // Published rendering resolves from the Revision's own frozen manifest;
  // Draft preview falls back to a live, tenant-scoped lookup (see
  // `resolve-media.ts`). Either way, a stale/cross-tenant/absent id simply
  // isn't returned, so it's silently skipped below rather than breaking
  // the whole gallery (docs/RENDERING.md#error-handling).
  const byId = await resolveMediaDescriptors(props.mediaAssetIds, context);

  return (
    <section
      key={id}
      data-block="gallery"
      style={{ padding: `clamp(3rem, 8vw, 7rem) clamp(1.25rem, 5vw, 4rem)` }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
          gap: t["spacing.medium"],
        }}
      >
        {props.mediaAssetIds.map((mediaAssetId) => {
          const asset = byId.get(mediaAssetId);
          if (!asset) return null;
          // v0.9 — real width/height (zero CLS) and a `srcset` so a phone
          // never downloads a desktop-sized original; `loading="lazy"`
          // since a Gallery image is never the page's LCP element (Hero
          // is) — see docs/RENDERING.md#performance.
          const image = resolveResponsiveImage(asset);
          return (
            <img
              key={mediaAssetId}
              src={image.src}
              {...(image.srcSet
                ? { srcSet: image.srcSet, sizes: "(max-width: 640px) 100vw, 33vw" }
                : {})}
              width={image.width ?? undefined}
              height={image.height ?? undefined}
              loading="lazy"
              alt={asset.altText ?? ""}
              style={{
                width: "100%",
                aspectRatio: "4 / 3",
                borderRadius: t["radius.large"],
                objectFit: "cover",
                boxShadow: "0 20px 50px rgba(17,24,39,.12)",
              }}
            />
          );
        })}
      </div>
      {caption ? (
        <p
          style={{
            color: t["color.muted"],
            fontFamily: t["font.body"],
            marginTop: t["spacing.small"],
          }}
        >
          {caption}
        </p>
      ) : null}
    </section>
  );
};
