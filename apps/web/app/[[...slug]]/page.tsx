import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createBrandingCssVariables, renderNavigation } from "@provence360/renderer";
import { renderPublishedPage } from "@/lib/site-page";

// Optional catch-all: matches `/` (slug undefined) as well as `/about`,
// `/properties/villa-des-oliviers`, etc. — see docs/PUBLISHING.md#public-runtime.
// One route file replaces the v0.4 root-only `app/page.tsx`: the public
// runtime can now resolve *any* Page in the published Revision's snapshot,
// not only the home page, which is what makes a resolved internal
// navigation link (`{ kind: "page", slug }`) actually go somewhere.
interface SitePageProps {
  params: Promise<{ slug?: string[] }>;
}

function slugFromParams(slug: string[] | undefined): string {
  return (slug ?? []).join("/");
}

export default async function SitePage({ params }: SitePageProps) {
  const { slug } = await params;
  const rendered = await renderPublishedPage(slugFromParams(slug));
  if (!rendered) notFound();

  const { snapshot, elements } = rendered;
  const tokens = snapshot.theme.tokens;
  const branding = snapshot.branding;
  const nav = renderNavigation(snapshot.site.navigation, {
    locale: snapshot.site.defaultLocale,
    defaultLocale: snapshot.site.defaultLocale,
    tokens,
  });

  // v0.8 — the closed --site-* custom property set (see
  // docs/adr/0021-site-theme-branding-design-system.md), computed once,
  // server-side, from the Revision's own frozen branding. Applied
  // additively alongside the existing v0.3 token-driven inline styles
  // below (which every block renderer already consumes via
  // `context.tokens`) — a future premium component can consume
  // `var(--site-color-primary)` directly without any block that already
  // works today needing to change.
  const brandingVars = createBrandingCssVariables(branding);
  const logo = branding.brand.logo
    ? snapshot.media?.find((descriptor) => descriptor.id === branding.brand.logo?.mediaId)
    : undefined;

  return (
    <main
      style={{
        ...brandingVars,
        background: tokens["color.background"],
        color: tokens["color.text"],
        minHeight: "100vh",
      }}
    >
      {nav || logo ? (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: tokens["spacing.medium"],
            padding: tokens["spacing.medium"],
            maxWidth: tokens["container.wide"],
            margin: "0 auto",
          }}
        >
          {logo ? (
            // `logo.storageKey` is a frozen, tenant-scoped opaque
            // reference, not a Next.js-optimizable static asset path — the
            // same convention `gallery.tsx`'s own image rendering already
            // follows.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo.storageKey}
              alt={logo.altText ?? branding.brand.name ?? snapshot.site.name}
              style={{ height: 40, width: "auto" }}
            />
          ) : null}
          {nav}
        </header>
      ) : null}
      <div style={{ maxWidth: tokens["container.wide"], margin: "0 auto" }}>{elements}</div>
      <footer
        style={{
          textAlign: "center",
          padding: tokens["spacing.medium"],
          color: tokens["color.muted"],
          fontSize: 12,
        }}
      >
        {snapshot.site.publicName ?? snapshot.site.name} — Provence360 Engine
      </footer>
    </main>
  );
}

/**
 * v0.5, section 15 of the brief: the public runtime takes its SEO from the
 * *published* Revision's own frozen `seo` field, never from live Draft
 * data — a small, closed contract (title/description/robots/canonical/
 * og:image), not a full SEO platform (explicitly out of scope).
 */
export async function generateMetadata({ params }: SitePageProps): Promise<Metadata> {
  const { slug } = await params;
  const rendered = await renderPublishedPage(slugFromParams(slug));
  if (!rendered) return {};

  const { seo } = rendered.page;
  const { snapshot } = rendered;
  const locale = snapshot.site.defaultLocale;
  const title = seo.title?.[locale] ?? snapshot.site.publicName ?? snapshot.site.name;
  const description = seo.description?.[locale];
  const ogImage = seo.ogImageMediaId
    ? snapshot.media?.find((descriptor) => descriptor.id === seo.ogImageMediaId)
    : undefined;
  // v0.8 — the Revision's own frozen favicon reference, resolved the same
  // way `ogImage` already is (a lookup into the frozen media manifest, no
  // live tenant-scoped query at request time).
  const favicon = snapshot.branding.brand.favicon
    ? snapshot.media?.find(
        (descriptor) => descriptor.id === snapshot.branding.brand.favicon?.mediaId,
      )
    : undefined;

  return {
    title,
    ...(description ? { description } : {}),
    ...(seo.canonicalPath ? { alternates: { canonical: seo.canonicalPath } } : {}),
    robots: {
      index: seo.noIndex !== true,
      follow: seo.noFollow !== true,
    },
    ...(ogImage ? { openGraph: { images: [ogImage.storageKey] } } : {}),
    ...(favicon ? { icons: { icon: favicon.storageKey } } : {}),
  };
}
