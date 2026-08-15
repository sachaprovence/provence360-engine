import Link from "next/link";
import { listPagesForSite } from "@provence360/content";
import { withTenantPage } from "@/lib/actor";
import { tableStyle, tdStyle, thStyle } from "@/lib/form-styles";
import { CreatePageForm } from "./create-page-form";

export const dynamic = "force-dynamic";

export default async function SitePagesPage({
  params,
}: {
  params: Promise<{ tenantId: string; siteId: string }>;
}) {
  const { tenantId, siteId } = await params;

  const { pageList, canCreate } = await withTenantPage(
    tenantId,
    "page.read",
    async (tx, actor) => ({
      pageList: await listPagesForSite(tx, siteId),
      canCreate: actor.permissions.has("page.create"),
    }),
  );

  return (
    <div>
      <p style={{ fontSize: 13 }}>
        <Link href={`/admin/tenants/${tenantId}/sites/${siteId}`} style={{ color: "#6b7280" }}>
          ← Site
        </Link>
      </p>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Pages</h1>
      {canCreate ? <CreatePageForm tenantId={tenantId} siteId={siteId} /> : null}

      {pageList.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>No pages yet.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Slug</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Blocks</th>
            </tr>
          </thead>
          <tbody>
            {pageList.map((page) => (
              <tr key={page.id}>
                <td style={tdStyle}>
                  <Link
                    href={`/admin/tenants/${tenantId}/sites/${siteId}/pages/${page.id}`}
                    style={{ color: "#111827" }}
                  >
                    {page.internalName}
                  </Link>
                </td>
                <td style={{ ...tdStyle, color: "#6b7280" }}>{page.slug || "/"}</td>
                <td style={tdStyle}>{page.pageType}</td>
                <td style={tdStyle}>{page.status}</td>
                <td style={tdStyle}>{Array.isArray(page.content) ? page.content.length : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
