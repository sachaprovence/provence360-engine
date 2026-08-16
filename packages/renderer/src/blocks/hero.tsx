import type { HeroProps } from "@provence360/content";
import { resolveLocalizedString } from "@provence360/content";
import { listMediaAssetsByIds } from "@provence360/content";
import type { BlockRenderer } from "../block-renderer-registry";

export const heroRendererV1: BlockRenderer<HeroProps> = async ({ id, props, context }) => {
  const t = context.tokens;
  const headline = resolveLocalizedString(props.headline, context.locale, context.defaultLocale);
  const subheadline = props.subheadline
    ? resolveLocalizedString(props.subheadline, context.locale, context.defaultLocale)
    : undefined;
  const ctaLabel = props.ctaLabel
    ? resolveLocalizedString(props.ctaLabel, context.locale, context.defaultLocale)
    : undefined;

  const [background] = props.backgroundMediaId
    ? await listMediaAssetsByIds(context.tx, [props.backgroundMediaId])
    : [];

  return (
    <section
      key={id}
      data-block="hero"
      style={{
        padding: t["spacing.large"],
        borderRadius: t["radius.large"],
        background: background
          ? `${t["color.surface"]} url(${background.storageKey}) center/cover`
          : t["color.surface"],
        color: t["color.text"],
        textAlign: "center",
      }}
    >
      <h1 style={{ fontFamily: t["font.heading"], margin: 0, fontSize: "2.5rem" }}>{headline}</h1>
      {subheadline ? (
        <p
          style={{
            fontFamily: t["font.body"],
            color: t["color.muted"],
            marginTop: t["spacing.small"],
          }}
        >
          {subheadline}
        </p>
      ) : null}
      {ctaLabel && props.ctaHref ? (
        <a
          href={props.ctaHref}
          style={{
            display: "inline-block",
            marginTop: t["spacing.medium"],
            padding: `${t["spacing.small"]} ${t["spacing.medium"]}`,
            background: t["color.primary"],
            color: t["color.primaryContrast"],
            borderRadius: t["radius.small"],
            textDecoration: "none",
          }}
        >
          {ctaLabel}
        </a>
      ) : null}
    </section>
  );
};
