import type { HeroProps } from "@provence360/content";
import { resolveLocalizedString } from "@provence360/content";
import type { BlockRenderer } from "../block-renderer-registry";
import { resolveMediaDescriptor } from "../resolve-media";
import { resolveButtonStyle } from "../resolve-branding";
import { resolveResponsiveImage } from "../resolve-delivery-url";

export const heroRendererV1: BlockRenderer<HeroProps> = async ({ id, props, context }) => {
  const t = context.tokens;
  const buttonStyle = resolveButtonStyle(
    { base: t["color.primary"], foreground: t["color.primaryContrast"] },
    context.branding.buttons.primary.style,
  );
  const headline = resolveLocalizedString(props.headline, context.locale, context.defaultLocale);
  const subheadline = props.subheadline
    ? resolveLocalizedString(props.subheadline, context.locale, context.defaultLocale)
    : undefined;
  const ctaLabel = props.ctaLabel
    ? resolveLocalizedString(props.ctaLabel, context.locale, context.defaultLocale)
    : undefined;

  // Published rendering resolves from the Revision's own frozen manifest;
  // Draft preview falls back to a live, tenant-scoped lookup — see
  // `resolve-media.ts` and `RenderContext.media`'s own doc comment. Either
  // way, a stale/cross-tenant/absent id simply resolves to nothing — the
  // background falls back to a plain color, never an error.
  const background = props.backgroundMediaId
    ? await resolveMediaDescriptor(props.backgroundMediaId, context)
    : null;
  // v0.9 — resolves through the same-origin delivery route when the asset
  // has real fingerprint/variant data (see resolve-delivery-url.ts);
  // transparently falls back to the raw storageKey for a legacy/seed
  // asset that predates the ingestion pipeline, exactly the pre-v0.9
  // behavior.
  const backgroundSrc = background ? resolveResponsiveImage(background).src : null;

  return (
    <section
      key={id}
      data-block="hero"
      style={{
        position: "relative",
        isolation: "isolate",
        display: "grid",
        alignContent: "center",
        minHeight: "min(72vh, 760px)",
        padding: `clamp(4rem, 12vw, 9rem) clamp(1.5rem, 7vw, 6rem)`,
        borderRadius: t["radius.large"],
        background: backgroundSrc
          ? `linear-gradient(110deg, rgba(16, 24, 40, .76), rgba(16, 24, 40, .25)), url(${backgroundSrc}) center/cover`
          : `linear-gradient(135deg, ${t["color.surface"]}, ${t["color.background"]})`,
        color: backgroundSrc ? "#ffffff" : t["color.text"],
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      <h1
        style={{
          fontFamily: t["font.heading"],
          margin: 0,
          fontSize: "clamp(2.75rem, 8vw, 6.75rem)",
          lineHeight: 0.98,
          letterSpacing: "-0.045em",
          textWrap: "balance",
        }}
      >
        {headline}
      </h1>
      {subheadline ? (
        <p
          style={{
            fontFamily: t["font.body"],
            color: backgroundSrc ? "rgba(255,255,255,.88)" : t["color.muted"],
            margin: `${t["spacing.medium"]} auto 0`,
            maxWidth: "46rem",
            fontSize: "clamp(1.05rem, 2vw, 1.35rem)",
            lineHeight: 1.65,
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
            padding: `.9rem ${t["spacing.large"]}`,
            background: buttonStyle.background,
            color: buttonStyle.color,
            border: buttonStyle.border,
            borderRadius: "999px",
            textDecoration: "none",
            fontWeight: 700,
            boxShadow: "0 12px 30px rgba(0,0,0,.16)",
          }}
        >
          {ctaLabel}
        </a>
      ) : null}
    </section>
  );
};
