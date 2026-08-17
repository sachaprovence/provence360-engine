import type { HeroProps } from "@provence360/content";
import { resolveLocalizedString } from "@provence360/content";
import type { BlockRenderer } from "../block-renderer-registry";
import { resolveMediaDescriptor } from "../resolve-media";
import { resolveButtonStyle } from "../resolve-branding";

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
            background: buttonStyle.background,
            color: buttonStyle.color,
            border: buttonStyle.border,
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
