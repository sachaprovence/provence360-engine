import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getPageBySlug } from "@provence360/content";
import { sites } from "@provence360/database";
import { resolveSiteByHostname } from "@provence360/domains";
import { renderBlocks, resolveSiteThemeTokens, type RenderContext } from "@provence360/renderer";
import { withTenantContext } from "@provence360/tenant";

// The public request pipeline this Foundation exists to prove (v0.3):
//
//   Host -> DomainResolver -> Site -> Page -> Content -> Domain data -> Theme -> Renderer
//
// Nothing below is specific to any one tenant or site — the exact same
// code renders every seeded site (see packages/database/src/scripts/seed.ts
// for "Villa des Oliviers" vs "Mas du Luberon"), driven entirely by data:
// which Site the hostname resolves to, which Page/blocks that Site's
// content graph holds, and which Theme (+ overrides) it references. A
// Draft -> Release -> Publish pipeline is deferred to v0.4 (see
// docs/ROADMAP.md) — this always renders the current, live content.
export default async function SitePage() {
  const headerList = await headers();
  const host = headerList.get("host") ?? "";

  const resolved = await resolveSiteByHostname(host);
  if (!resolved || resolved.siteStatus !== "active") {
    notFound();
  }

  const { siteId, tenantId } = resolved;

  const rendered = await withTenantContext(tenantId, async (tx) => {
    const [site] = await tx.select().from(sites).where(eq(sites.id, siteId));
    if (!site) {
      // The domain resolved, but the tenant-scoped read (RLS-enforced)
      // found nothing — this would mean the resolver and RLS disagree,
      // which should be impossible. Fail loud rather than render a lie.
      throw new Error(
        `Resolved site ${siteId} was not visible under tenant ${tenantId}'s own context.`,
      );
    }

    const page = await getPageBySlug(tx, site.id, "");
    if (!page) return null;

    const tokens = await resolveSiteThemeTokens(tx, site);
    const context: RenderContext = {
      tx,
      tenantId,
      siteId: site.id,
      locale: site.defaultLocale,
      defaultLocale: site.defaultLocale,
      tokens,
    };

    const elements = await renderBlocks(page.content as unknown[], context);
    return { site, tokens, elements };
  });

  if (!rendered) {
    notFound();
  }

  const { site, tokens, elements } = rendered;

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
        {site.publicName ?? site.name} — Provence360 Engine
      </footer>
    </main>
  );
}
