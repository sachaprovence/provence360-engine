import type { CtaProps } from "@provence360/content";
import { resolveLocalizedString } from "@provence360/content";
import type { BlockRenderer } from "../block-renderer-registry";
import { resolveButtonStyle } from "../resolve-branding";

export const ctaRendererV1: BlockRenderer<CtaProps> = ({ id, props, context }) => {
  const t = context.tokens;
  const buttonStyle = resolveButtonStyle(
    { base: t["color.primary"], foreground: t["color.primaryContrast"] },
    context.branding.buttons.primary.style,
  );
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
        margin: `clamp(2rem, 6vw, 5rem) clamp(1rem, 5vw, 4rem)`,
        padding: `clamp(3rem, 8vw, 6rem) clamp(1.5rem, 6vw, 5rem)`,
        borderRadius: t["radius.large"],
        background: t["color.accent"],
        color: t["color.primaryContrast"],
        textAlign: "center",
      }}
    >
      {heading ? (
        <h2
          style={{
            fontFamily: t["font.heading"],
            marginTop: 0,
            fontSize: "clamp(2rem, 5vw, 3.75rem)",
          }}
        >
          {heading}
        </h2>
      ) : null}
      {body ? (
        <p style={{ fontFamily: t["font.body"], fontSize: "1.1rem", lineHeight: 1.7 }}>
          {body}
        </p>
      ) : null}
      <a
        href={props.buttonHref}
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
        }}
      >
        {buttonLabel}
      </a>
    </section>
  );
};
