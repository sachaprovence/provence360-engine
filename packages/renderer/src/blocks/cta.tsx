import type { CtaProps } from "@provence360/content";
import { resolveLocalizedString } from "@provence360/content";
import type { BlockRenderer } from "../block-renderer-registry";

export const ctaRendererV1: BlockRenderer<CtaProps> = ({ id, props, context }) => {
  const t = context.tokens;
  const heading = props.heading
    ? resolveLocalizedString(props.heading, context.locale, context.defaultLocale)
    : undefined;
  const body = props.body
    ? resolveLocalizedString(props.body, context.locale, context.defaultLocale)
    : undefined;
  const buttonLabel = resolveLocalizedString(
    props.buttonLabel,
    context.locale,
    context.defaultLocale,
  );

  return (
    <section
      key={id}
      data-block="cta"
      style={{
        padding: t["spacing.large"],
        borderRadius: t["radius.medium"],
        background: t["color.accent"],
        color: t["color.primaryContrast"],
        textAlign: "center",
      }}
    >
      {heading ? <h2 style={{ fontFamily: t["font.heading"], marginTop: 0 }}>{heading}</h2> : null}
      {body ? <p style={{ fontFamily: t["font.body"] }}>{body}</p> : null}
      <a
        href={props.buttonHref}
        style={{
          display: "inline-block",
          padding: `${t["spacing.small"]} ${t["spacing.medium"]}`,
          background: t["color.primary"],
          color: t["color.primaryContrast"],
          borderRadius: t["radius.small"],
          textDecoration: "none",
        }}
      >
        {buttonLabel}
      </a>
    </section>
  );
};
