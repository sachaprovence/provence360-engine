import Link from "next/link";
import { notFound } from "next/navigation";
import { blockRegistry, getPage } from "@provence360/content";
import { withTenantPage } from "@/lib/actor";
import { AddBlockForm } from "./add-block-form";
import { BlocksEditor, type BlockRow } from "./blocks-editor";
import { PageMetaForm } from "./page-meta-form";

export const dynamic = "force-dynamic";

export default async function PageEditorPage({
  params,
}: {
  params: Promise<{ tenantId: string; siteId: string; pageId: string }>;
}) {
  const { tenantId, siteId, pageId } = await params;

  const { page, canUpdate } = await withTenantPage(tenantId, "page.read", async (tx, actor) => ({
    page: await getPage(tx, pageId),
    canUpdate: actor.permissions.has("page.update"),
  }));

  if (!page || page.siteId !== siteId) notFound();

  const blocks = page.content as BlockRow[];
  const availableBlocks = blockRegistry.list().map((definition) => ({
    type: definition.type,
    version: definition.version,
  }));

  return (
    <div>
      <p style={{ fontSize: 13 }}>
        <Link
          href={`/admin/tenants/${tenantId}/sites/${siteId}/pages`}
          style={{ color: "#6b7280" }}
        >
          ← Pages
        </Link>
      </p>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>{page.internalName}</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>
        {page.pageType} · {page.slug || "/"}
      </p>

      {canUpdate ? (
        <PageMetaForm tenantId={tenantId} siteId={siteId} pageId={pageId} page={page} />
      ) : (
        <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 20 }}>Status: {page.status}</p>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Blocks</h2>
      <BlocksEditor
        tenantId={tenantId}
        siteId={siteId}
        pageId={pageId}
        blocks={blocks}
        canEdit={canUpdate}
      />

      {canUpdate ? (
        <>
          <h2 style={{ fontSize: 16, margin: "20px 0 8px" }}>Add a block</h2>
          <AddBlockForm
            tenantId={tenantId}
            siteId={siteId}
            pageId={pageId}
            availableBlocks={availableBlocks}
          />
        </>
      ) : null}
    </div>
  );
}
