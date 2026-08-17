import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { renderNavigation } from "@provence360/renderer";
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
  const nav = renderNavigation(snapshot.site.navigation, {
    locale: snapshot.site.defaultLocale,
    defaultLocale: snapshot.site.defaultLocale,
    tokens,
  });

  return (
    <main
      style={{
        background: tokens["color.background"],
        color: tokens["color.text"],
        minHeight: "100vh",
      }}
    >
      {nav ? (
        <header
          style={{
            padding: tokens["spacing.medium"],
            maxWidth: tokens["container.wide"],
            margin: "0 auto",
          }}
        >
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

  return {
    title,
    ...(description ? { description } : {}),
    ...(seo.canonicalPath ? { alternates: { canonical: seo.canonicalPath } } : {}),
    robots: {
      index: seo.noIndex !== true,
      follow: seo.noFollow !== true,
    },
    ...(ogImage ? { openGraph: { images: [ogImage.storageKey] } } : {}),
  };
}
