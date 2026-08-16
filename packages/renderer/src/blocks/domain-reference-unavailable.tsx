import type { ThemeTokens } from "@provence360/themes";

/**
 * Rendered in place of a domain-bound block (PropertySummary, UnitGrid,
 * Amenities) whose reference (a `propertyId`/`unitId`) resolves to
 * nothing — because it was deleted, or because it belongs to another
 * tenant (RLS already filtered it out before this component ever ran).
 * Deliberately generic: it never echoes back the id or any detail that
 * would help an attacker distinguish "deleted" from "exists but isn't
 * mine" (see the cross-tenant renderer test in render-page.test.tsx).
 */
export function DomainReferenceUnavailable({
  id,
  blockType,
  tokens,
}: {
  id: string;
  blockType: string;
  tokens: ThemeTokens;
}) {
  return (
    <section
      key={id}
      data-block={blockType}
      data-block-unavailable="true"
      style={{
        padding: tokens["spacing.medium"],
        borderRadius: tokens["radius.small"],
        background: tokens["color.surface"],
        color: tokens["color.muted"],
        fontFamily: tokens["font.body"],
      }}
    >
      Content unavailable.
    </section>
  );
}
