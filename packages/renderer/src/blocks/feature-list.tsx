import type { FeatureListProps } from "@provence360/content";
import { resolveLocalizedString } from "@provence360/content";
import type { BlockRenderer } from "../block-renderer-registry";

export const featureListRendererV1: BlockRenderer<FeatureListProps> = ({ id, props, context }) => {
  const t = context.tokens;
  const heading = props.heading
    ? resolveLocalizedString(props.heading, context.locale, context.defaultLocale)
    : undefined;

  return (
    <section
      key={id}
      data-block="feature-list"
      style={{ padding: `clamp(3rem, 8vw, 7rem) clamp(1.25rem, 5vw, 4rem)` }}
    >
      {heading ? (
        <h2
          style={{
            fontFamily: t["font.heading"],
            color: t["color.text"],
            textAlign: "center",
            fontSize: "clamp(2rem, 5vw, 3.5rem)",
            margin: `0 0 ${t["spacing.large"]}`,
          }}
        >
          {heading}
        </h2>
      ) : null}
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
          gap: t["spacing.medium"],
        }}
      >
        {props.items.map((item, index) => (
          <li
            key={index}
            style={{
              padding: t["spacing.large"],
              borderRadius: t["radius.large"],
              background: t["color.surface"],
              border: `1px solid ${t["color.border"]}`,
              boxShadow: "0 18px 45px rgba(17,24,39,.06)",
            }}
          >
            <strong style={{ fontFamily: t["font.heading"], color: t["color.text"] }}>
              {resolveLocalizedString(item.title, context.locale, context.defaultLocale)}
            </strong>
            {item.description ? (
              <p
                style={{
                  color: t["color.muted"],
                  fontFamily: t["font.body"],
                  margin: `${t["spacing.small"]} 0 0`,
                  lineHeight: 1.65,
                }}
              >
                {resolveLocalizedString(item.description, context.locale, context.defaultLocale)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
};
