import { cache } from "react";
import { headers } from "next/headers";
import { resolveSiteByHostname } from "@provence360/domains";
import { getPublishedRevision } from "@provence360/publishing";
import {
  renderBlocks,
  type FrozenMediaDescriptor,
  type RenderContext,
} from "@provence360/renderer";
import { withTenantContext } from "@provence360/tenant";
import type { ReactElement } from "react";

export interface RenderedSitePage {
  snapshot: NonNullable<Awaited<ReturnType<typeof getPublishedRevision>>>["snapshot"];
  page: NonNullable<
    NonNullable<Awaited<ReturnType<typeof getPublishedRevision>>>["snapshot"]
  >["pages"][number];
  elements: ReactElement[];
}

/**
 * The public request pipeline (v0.5 — see docs/PUBLISHING.md/RENDERING.md):
 *
 *   Host -> DomainResolver -> Site -> Published Revision -> requested Page -> Renderer
 *
 * `slug` is the joined path segments below the Site's root (`""` for `/`,
 * `"about"` for `/about`, etc. — see `app/[[...slug]]/page.tsx`). This
 * reads ONLY `getPublishedRevision` — never the live `pages`/`sites` draft
 * rows directly — and the resolved Page is looked up inside the frozen
 * snapshot's own `pages` array, never a fresh `pages` table query, so a
 * Draft edit (including a slug rename) can never change what a visitor
 * sees until the next publish (Invariant A/B).
 *
 * Wrapped in React's `cache()` so `generateMetadata` and the page
 * component itself (both of which need the same resolved page) share one
 * DB round-trip per request instead of two.
 */
export const renderPublishedPage = cache(async (slug: string): Promise<RenderedSitePage | null> => {
  const headerList = await headers();
  const host = headerList.get("host") ?? "";

  const resolved = await resolveSiteByHostname(host);
  if (!resolved || resolved.siteStatus !== "active") return null;
  const { siteId, tenantId } = resolved;

  return withTenantContext(tenantId, async (tx) => {
    const published = await getPublishedRevision(tx, siteId);
    // A Site that has never been published, or whose Revision no longer
    // contains the requested slug, renders nothing — the same
    // deterministic 404 as an unresolvable hostname (no information leak
    // about a tenant's setup progress or its set of pages).
    if (!published) return null;
    const page = published.snapshot.pages.find((p) => p.slug === slug);
    if (!page) return null;

    // Published rendering hands the renderer the Revision's own frozen
    // media manifest (when the Revision has one — legacy pre-v0.5
    // Revisions don't, see `parseSiteSnapshot`), never a live lookup — see
    // `RenderContext.media`'s own doc comment for why.
    const media: ReadonlyMap<string, FrozenMediaDescriptor> | undefined = published.snapshot.media
      ? new Map(published.snapshot.media.map((descriptor) => [descriptor.id, descriptor]))
      : undefined;

    const context: RenderContext = {
      tx,
      tenantId,
      siteId,
      locale: published.snapshot.site.defaultLocale,
      defaultLocale: published.snapshot.site.defaultLocale,
      tokens: published.snapshot.theme.tokens,
      media,
      // Every visitor reaching this pipeline is a real public visitor —
      // see `RenderContext.publicOnly`'s own doc comment for what this
      // gates (Rental data status + location-privacy filtering).
      publicOnly: true,
    };

    const elements = await renderBlocks(page.content, context);
    return { snapshot: published.snapshot, page, elements };
  });
});
