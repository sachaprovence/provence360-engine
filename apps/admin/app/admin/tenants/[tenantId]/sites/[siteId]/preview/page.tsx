import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageBySlug } from "@provence360/content";
import {
  createBrandingCssVariables,
  renderBlocks,
  resolveMediaDescriptor,
  resolveSiteThemeTokens,
  type RenderContext,
} from "@provence360/renderer";
import { getSite } from "@provence360/sites";
import { resolveSiteBranding } from "@provence360/themes";
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
 *
 * v0.8 — the same parity applies to branding: `resolveSiteBranding` reads
 * the Site's live `branding` column (never a frozen snapshot, since this
 * is a Draft preview), exactly mirroring `resolveSiteThemeTokens`'s own
 * live-vs-frozen split. See docs/adr/0021-site-theme-branding-design-system.md.
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
    const branding = resolveSiteBranding(site.branding);
    const context: RenderContext = {
      tx,
      tenantId,
      siteId,
      locale: site.defaultLocale,
      defaultLocale: site.defaultLocale,
      tokens,
      branding,
    };
    const elements = await renderBlocks(page.content as unknown[], context);
    const logo = branding.brand.logo
      ? await resolveMediaDescriptor(branding.brand.logo.mediaId, context)
      : null;
    return { site, tokens, branding, logo, elements };
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
            ...(rendered.branding ? createBrandingCssVariables(rendered.branding) : {}),
            background: rendered.tokens?.["color.background"],
            color: rendered.tokens?.["color.text"],
            minHeight: "100vh",
          }}
        >
          {rendered.logo ? (
            <div
              style={{
                padding: rendered.tokens?.["spacing.medium"],
                maxWidth: rendered.tokens?.["container.wide"],
                margin: "0 auto",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- same opaque-storageKey convention as the public runtime's page shell */}
              <img
                src={rendered.logo.storageKey}
                alt={rendered.logo.altText ?? rendered.branding?.brand.name ?? site.name}
                style={{ height: 40, width: "auto" }}
              />
            </div>
          ) : null}
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
