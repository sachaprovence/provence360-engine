import Link from "next/link";
import { notFound } from "next/navigation";
import { blockRegistry, getPage, listMediaAssets } from "@provence360/content";
import { withTenantPage } from "@/lib/actor";
import { resolveMediaThumbnail } from "@/lib/media-thumbnail";
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

  const { page, canUpdate, mediaList } = await withTenantPage(
    tenantId,
    "page.read",
    async (tx, actor) => {
      const canUpdateNow = actor.permissions.has("page.update");
      // Only fetched for an editor who can actually use the Hero/Gallery
      // media pickers below — same "skip the extra read when it can't be
      // used" convention the v0.8 Branding form already established (see
      // sites/[siteId]/page.tsx).
      const mediaRows = canUpdateNow ? await listMediaAssets(tx) : [];
      return {
        page: await getPage(tx, pageId),
        canUpdate: canUpdateNow,
        mediaList: mediaRows,
      };
    },
  );

  if (!page || page.siteId !== siteId) notFound();

  const blocks = page.content as BlockRow[];
  const mediaOptions = mediaList.map((asset) => {
    const thumbnail = resolveMediaThumbnail(asset);
    return {
      id: thumbnail.id,
      previewUrl: thumbnail.previewUrl,
      altText: thumbnail.altText,
      originalFilename: thumbnail.originalFilename,
    };
  });
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
        mediaOptions={mediaOptions}
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
