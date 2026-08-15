import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { sites, tenants } from "@provence360/database";
import { resolveSiteByHostname } from "@provence360/domains";
import { withTenantContext } from "@provence360/tenant";

// The public request pipeline this Foundation exists to prove:
//
//   Host -> DomainResolver -> Site -> Tenant -> PublishedRelease -> Renderer
//
// PublishedRelease/the real Renderer (themes, blocks, content) are out of
// scope for v0.1 (see docs/ROADMAP.md) — this page resolves all the way
// through Tenant and renders a placeholder proving the pipeline is real,
// not stubbed.
export default async function SitePage() {
  const headerList = await headers();
  const host = headerList.get("host") ?? "";

  const resolved = await resolveSiteByHostname(host);
  if (!resolved) {
    notFound();
  }

  const { siteId, tenantId, siteStatus } = resolved;

  const details = await withTenantContext(tenantId, async (tx) => {
    const [site] = await tx.select().from(sites).where(eq(sites.id, siteId));
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    return { site, tenant };
  });

  if (!details.site || !details.tenant) {
    // The domain resolved, but the tenant-scoped read (RLS-enforced) found
    // nothing — this would mean the resolver and RLS disagree, which should
    // be impossible. Fail loud rather than render a lie.
    throw new Error(
      `Resolved site ${siteId} was not visible under tenant ${tenantId}'s own context.`,
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1.5rem" }}>
      <p style={{ textTransform: "uppercase", fontSize: 12, letterSpacing: 1, color: "#6b7280" }}>
        Provence360 Engine — Foundation v0.1
      </p>
      <h1 style={{ fontSize: 32, marginBottom: 4 }}>{details.site.name}</h1>
      <p style={{ color: "#374151" }}>Operated by {details.tenant.name}</p>
      <dl style={{ marginTop: 32, fontSize: 14, color: "#4b5563" }}>
        <div>
          <dt style={{ display: "inline", fontWeight: 600 }}>Resolved host: </dt>
          <dd style={{ display: "inline" }}>{host}</dd>
        </div>
        <div>
          <dt style={{ display: "inline", fontWeight: 600 }}>Site status: </dt>
          <dd style={{ display: "inline" }}>{siteStatus}</dd>
        </div>
      </dl>
    </main>
  );
}
