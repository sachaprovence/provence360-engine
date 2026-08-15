import type { TextProps } from "@provence360/content";
import { resolveLocalizedString } from "@provence360/content";
import type { BlockRenderer } from "../block-renderer-registry";

// Plain text only, rendered as JSX children — React escapes text content
// by default, so this is safe against script/markup injection by
// construction. `dangerouslySetInnerHTML` is never used anywhere in this
// package (see docs/RENDERING.md#security). A block-level "\n" separates
// paragraphs, matching the write-side contract in packages/content/src/blocks/text.ts.
export const textRendererV1: BlockRenderer<TextProps> = ({ id, props, context }) => {
  const t = context.tokens;
  const heading = props.heading
    ? resolveLocalizedString(props.heading, context.locale, context.defaultLocale)
    : undefined;
  const body = resolveLocalizedString(props.body, context.locale, context.defaultLocale) ?? "";

  return (
    <section
      key={id}
      data-block="text"
      style={{ padding: t["spacing.medium"], color: t["color.text"] }}
    >
      {heading ? <h2 style={{ fontFamily: t["font.heading"], marginTop: 0 }}>{heading}</h2> : null}
      {body.split("\n").map((paragraph, index) => (
        <p key={index} style={{ fontFamily: t["font.body"] }}>
          {paragraph}
        </p>
      ))}
    </section>
  );
};
