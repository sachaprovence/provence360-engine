import type { ReactElement } from "react";
import { resolveLocalizedString } from "@provence360/content";
import type { RenderContext } from "./render-context";

/**
 * Structurally compatible with `packages/publishing`'s `ResolvedNavigation`
 * (never imported — same "no dependency on `publishing`" reasoning as
 * `RenderContext.media`/`FrozenMediaDescriptor`, see render-context.ts).
 */
export interface RenderableNavigationTarget {
  kind: "page" | "external";
  slug?: string | undefined;
  href?: string | undefined;
  newTab?: boolean | undefined;
}
export interface RenderableNavigationItem {
  id: string;
  label: Record<string, string>;
  target: RenderableNavigationTarget;
  children: RenderableNavigationItem[];
}
export interface RenderableNavigation {
  items: RenderableNavigationItem[];
}

/** A resolved `{kind:"page", slug}` target becomes a real site-relative href — `""` (home) maps to `/`, anything else to `/<slug>`. */
function targetHref(target: RenderableNavigationTarget): string {
  if (target.kind === "external") return target.href ?? "#";
  const slug = target.slug ?? "";
  return slug === "" ? "/" : `/${slug}`;
}

function NavigationItem({
  item,
  context,
}: {
  item: RenderableNavigationItem;
  context: Pick<RenderContext, "locale" | "defaultLocale" | "tokens">;
}): ReactElement {
  const t = context.tokens;
  const label = resolveLocalizedString(item.label, context.locale, context.defaultLocale) ?? "";
  return (
    <li key={item.id}>
      <a
        href={targetHref(item.target)}
        {...(item.target.kind === "external" && item.target.newTab
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
        style={{
          color: t["color.text"],
          fontFamily: t["font.body"],
          textDecoration: "none",
          fontWeight: 600,
          padding: `${t["spacing.small"]} 0`,
        }}
      >
        {label}
      </a>
      {item.children.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, paddingLeft: t["spacing.small"] }}>
          {item.children.map((child) => (
            <NavigationItem key={child.id} item={child} context={context} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Renders a Site's resolved navigation as Site chrome (section 4 of the
 * v0.5 brief) — a plain nested list of links, deliberately unstyled beyond
 * the closed theme-token set (docs/RENDERING.md#security: no arbitrary
 * CSS). An empty navigation (no items at all — the common case pre-v0.5,
 * and every legacy Revision — see `parseSiteSnapshot`'s legacy branch)
 * renders nothing, not an empty `<nav>` shell.
 */
export function renderNavigation(
  navigation: RenderableNavigation,
  context: Pick<RenderContext, "locale" | "defaultLocale" | "tokens">,
): ReactElement | null {
  if (navigation.items.length === 0) return null;
  return (
    <nav aria-label="Main">
      <ul
        style={{
          listStyle: "none",
          display: "flex",
          flexWrap: "wrap",
          gap: context.tokens["spacing.medium"],
          margin: 0,
          padding: 0,
        }}
      >
        {navigation.items.map((item) => (
          <NavigationItem key={item.id} item={item} context={context} />
        ))}
      </ul>
    </nav>
  );
}
