import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveSiteByHostname } from "@provence360/domains";
import { getPublishedRevision } from "@provence360/publishing";
import { renderBlocks, type RenderContext } from "@provence360/renderer";
import { withTenantContext } from "@provence360/tenant";

// The public request pipeline (v0.4 — see docs/PUBLISHING.md):
//
//   Host -> DomainResolver -> Site -> Published Revision -> Renderer
//
// Nothing below is specific to any one tenant or site — the exact same
// code renders every seeded site (see packages/database/src/scripts/seed.ts
// and packages/publishing/src/scripts/publish-seeded-sites.ts), driven
// entirely by data. This reads ONLY `getPublishedRevision` — never the
// live `pages`/`sites` draft rows directly — so editing a Site's draft in
// the admin Site Editor can never change what a visitor sees until an
// OWNER/ADMIN explicitly publishes (Invariant A/B: the public runtime
// never depends on a mutable draft).
export default async function SitePage() {
  const headerList = await headers();
  const host = headerList.get("host") ?? "";

  const resolved = await resolveSiteByHostname(host);
  if (!resolved || resolved.siteStatus !== "active") {
    notFound();
  }

  const { siteId, tenantId } = resolved;

  const rendered = await withTenantContext(tenantId, async (tx) => {
    const published = await getPublishedRevision(tx, siteId);
    // A Site that has never been published (or whose home page was
    // removed from the draft before the last publish) renders nothing —
    // the same deterministic 404 as an unresolvable hostname, so a
    // visitor can't distinguish "never published" from "domain doesn't
    // exist" (no information leak about a tenant's setup progress).
    if (!published) return null;
    const homePage = published.snapshot.pages.find((page) => page.slug === "");
    if (!homePage) return null;

    const context: RenderContext = {
      tx,
      tenantId,
      siteId,
      locale: published.snapshot.site.defaultLocale,
      defaultLocale: published.snapshot.site.defaultLocale,
      tokens: published.snapshot.theme.tokens,
    };

    const elements = await renderBlocks(homePage.content, context);
    return { snapshot: published.snapshot, elements };
  });

  if (!rendered) {
    notFound();
  }

  const { snapshot, elements } = rendered;
  const tokens = snapshot.theme.tokens;

  return (
    <main
      style={{
        background: tokens["color.background"],
        color: tokens["color.text"],
        minHeight: "100vh",
      }}
    >
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
