import type { FeatureListProps } from "@provence360/content";
import { resolveLocalizedString } from "@provence360/content";
import type { BlockRenderer } from "../block-renderer-registry";

export const featureListRendererV1: BlockRenderer<FeatureListProps> = ({ id, props, context }) => {
  const t = context.tokens;
  const heading = props.heading
    ? resolveLocalizedString(props.heading, context.locale, context.defaultLocale)
    : undefined;

  return (
    <section key={id} data-block="feature-list" style={{ padding: t["spacing.medium"] }}>
      {heading ? (
        <h2 style={{ fontFamily: t["font.heading"], color: t["color.text"] }}>{heading}</h2>
      ) : null}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: t["spacing.small"] }}>
        {props.items.map((item, index) => (
          <li
            key={index}
            style={{
              padding: t["spacing.small"],
              borderRadius: t["radius.small"],
              background: t["color.surface"],
            }}
          >
            <strong style={{ fontFamily: t["font.heading"], color: t["color.text"] }}>
              {resolveLocalizedString(item.title, context.locale, context.defaultLocale)}
            </strong>
            {item.description ? (
              <p style={{ color: t["color.muted"], fontFamily: t["font.body"], margin: 0 }}>
                {resolveLocalizedString(item.description, context.locale, context.defaultLocale)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
};
