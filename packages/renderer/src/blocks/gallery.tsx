import type { GalleryProps } from "@provence360/content";
import { listMediaAssetsByIds, resolveLocalizedString } from "@provence360/content";
import type { BlockRenderer } from "../block-renderer-registry";

export const galleryRendererV1: BlockRenderer<GalleryProps> = async ({ id, props, context }) => {
  const t = context.tokens;
  const caption = props.caption
    ? resolveLocalizedString(props.caption, context.locale, context.defaultLocale)
    : undefined;

  // Tenant-scoped lookup: a stale or cross-tenant media id simply isn't
  // returned, so it's silently skipped below rather than breaking the
  // whole gallery (docs/RENDERING.md#error-handling).
  const assets = await listMediaAssetsByIds(context.tx, props.mediaAssetIds);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  return (
    <section key={id} data-block="gallery" style={{ padding: t["spacing.medium"] }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: t["spacing.small"],
        }}
      >
        {props.mediaAssetIds.map((mediaAssetId) => {
          const asset = byId.get(mediaAssetId);
          if (!asset) return null;
          return (
            <img
              key={mediaAssetId}
              src={asset.storageKey}
              alt={asset.altText ?? ""}
              style={{ width: "100%", borderRadius: t["radius.medium"], objectFit: "cover" }}
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
