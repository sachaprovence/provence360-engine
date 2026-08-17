import { listMediaAssets } from "@provence360/content";
import { resolveMediaThumbnail } from "@/lib/media-thumbnail";
import { withTenantPage } from "@/lib/actor";
import { MediaUploadForm } from "./media-upload-form";

export const dynamic = "force-dynamic";

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: 14,
};

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 8,
  display: "grid",
  gap: 6,
  fontSize: 12,
};

const previewBoxStyle = {
  width: "100%",
  aspectRatio: "1 / 1",
  borderRadius: 4,
  background: "#f3f4f6",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden" as const,
  fontSize: 11,
  color: "#9ca3af",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${String(bytes)} B`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Admin Media Library (brief §17): upload, thumbnail grid, dimensions,
 * type, alt text, date — deliberately sober, not a full DAM (no virtual
 * folders, no tagging, no crop editor). Tenant-scoped: `media_assets.tenantId`
 * is the tenant, not the Site, matching `listMediaAssets`'s own scope — the
 * same level the pre-existing Branding picker already reads from.
 */
export default async function MediaLibraryPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const { mediaList, canCreate } = await withTenantPage(
    tenantId,
    "media.read",
    async (tx, actor) => ({
      mediaList: await listMediaAssets(tx),
      canCreate: actor.permissions.has("media.create"),
    }),
  );

  const items = mediaList.map(resolveMediaThumbnail);

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Media</h1>

      {canCreate ? <MediaUploadForm tenantId={tenantId} /> : null}

      {items.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>No media uploaded yet.</p>
      ) : (
        <div style={gridStyle}>
          {items.map((item) => (
            <div key={item.id} data-testid="media-card" style={cardStyle}>
              <div style={previewBoxStyle}>
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Admin-only Media Library grid; see apps/admin/lib/media-picker.tsx for the same rationale.
                  <img
                    src={item.previewUrl}
                    alt={item.altText ?? ""}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <span>{item.kind}</span>
                )}
              </div>
              <strong
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {item.originalFilename ?? item.id}
              </strong>
              <span style={{ color: "#6b7280" }}>
                {item.width && item.height ? `${String(item.width)}×${String(item.height)} · ` : ""}
                {item.mimeType} · {formatBytes(item.byteSize)}
              </span>
              {item.altText ? <span style={{ color: "#6b7280" }}>Alt: {item.altText}</span> : null}
              <span style={{ color: "#9ca3af" }}>{item.createdAt.toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
