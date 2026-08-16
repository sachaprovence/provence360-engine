import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageBySlug } from "@provence360/content";
import { renderBlocks, resolveSiteThemeTokens, type RenderContext } from "@provence360/renderer";
import { getSite } from "@provence360/sites";
import { withTenantPage } from "@/lib/actor";

export const dynamic = "force-dynamic";

/**
 * Renders the Site's current DRAFT (the live, mutable `pages`/`sites` rows
 * — never a Revision) through the exact same `@provence360/renderer` code
 * the public runtime uses, so "preview" and "what publishing would freeze"
 * never drift apart. Gated by `release.read` through `withTenantPage` —
 * the same full session + membership + permission chain every other admin
 * page goes through, never a bare shareable link or a token (see
 * docs/PUBLISHING.md#preview): a random UUID alone gets you nowhere near
 * this route.
 */
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ tenantId: string; siteId: string }>;
}) {
  const { tenantId, siteId } = await params;

  const rendered = await withTenantPage(tenantId, "release.read", async (tx) => {
    const site = await getSite(tx, siteId);
    if (!site) return null;

    const page = await getPageBySlug(tx, siteId, "");
    if (!page) return { site, elements: null };

    const tokens = await resolveSiteThemeTokens(tx, site);
    const context: RenderContext = {
      tx,
      tenantId,
      siteId,
      locale: site.defaultLocale,
      defaultLocale: site.defaultLocale,
      tokens,
    };
    const elements = await renderBlocks(page.content as unknown[], context);
    return { site, tokens, elements };
  });

  if (!rendered) notFound();
  const { site } = rendered;

  return (
    <div>
      <div
        style={{
          padding: "8px 16px",
          background: "#fef3c7",
          color: "#92400e",
          fontSize: 13,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>
          Preview of <strong>{site.name}</strong>&apos;s draft — not what visitors currently see.
        </span>
        <Link
          href={`/admin/tenants/${tenantId}/sites/${siteId}/publishing`}
          style={{ color: "#92400e" }}
        >
          ← Back to Publishing
        </Link>
      </div>
      {rendered.elements ? (
        <main
          style={{
            background: rendered.tokens?.["color.background"],
            color: rendered.tokens?.["color.text"],
            minHeight: "100vh",
          }}
        >
          <div style={{ maxWidth: rendered.tokens?.["container.wide"], margin: "0 auto" }}>
            {rendered.elements}
          </div>
        </main>
      ) : (
        <p style={{ padding: 16, fontSize: 14, color: "#6b7280" }}>
          This Site&apos;s draft has no home page yet.
        </p>
      )}
    </div>
  );
}
