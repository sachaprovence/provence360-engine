import Link from "next/link";
import { notFound } from "next/navigation";
import { getDraftSummary, listPublicationHistory, listRevisions } from "@provence360/publishing";
import { getSite } from "@provence360/sites";
import { withTenantPage } from "@/lib/actor";
import { PublishForm, RollbackForm } from "./publishing-actions-client";

export const dynamic = "force-dynamic";

export default async function PublishingPage({
  params,
}: {
  params: Promise<{ tenantId: string; siteId: string }>;
}) {
  const { tenantId, siteId } = await params;

  const { site, summary, revisions, history, canPublish } = await withTenantPage(
    tenantId,
    "release.read",
    async (tx, actor) => {
      const siteRow = await getSite(tx, siteId);
      if (!siteRow) return { site: null } as const;
      return {
        site: siteRow,
        summary: await getDraftSummary(tx, siteId),
        revisions: await listRevisions(tx, siteId),
        history: await listPublicationHistory(tx, siteId),
        canPublish: actor.permissions.has("release.publish"),
      };
    },
  );

  if (!site) notFound();

  const base = `/admin/tenants/${tenantId}/sites/${siteId}`;

  return (
    <div>
      <p style={{ fontSize: 13 }}>
        <Link href={base} style={{ color: "#6b7280" }}>
          ← {site.name}
        </Link>
      </p>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Publishing</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>{site.slug}</p>

      <section
        style={{ marginBottom: 24, padding: 16, border: "1px solid #e5e7eb", borderRadius: 8 }}
      >
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Status</h2>
        {summary.publishedRevisionId ? (
          <p style={{ fontSize: 14, marginBottom: 8 }}>
            Live: revision #{summary.publishedRevisionNumber}
            {summary.publishedAt ? ` · published ${summary.publishedAt.toISOString()}` : ""}
          </p>
        ) : (
          <p style={{ fontSize: 14, marginBottom: 8, color: "#6b7280" }}>Never published.</p>
        )}

        {summary.issues.length > 0 ? (
          <div style={{ marginBottom: 8 }}>
            <p style={{ fontSize: 13, color: "#b91c1c", fontWeight: 600 }}>
              Draft is not publishable right now:
            </p>
            <ul style={{ fontSize: 13, color: "#b91c1c", margin: "4px 0 0 18px" }}>
              {summary.issues.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : summary.hasUnpublishedChanges ? (
          <p style={{ fontSize: 13, color: "#92400e", marginBottom: 8 }}>
            The draft has unpublished changes.
          </p>
        ) : (
          <p style={{ fontSize: 13, color: "#166534", marginBottom: 8 }}>
            The draft matches what&apos;s published — nothing to publish.
          </p>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {canPublish && summary.hasUnpublishedChanges && summary.issues.length === 0 ? (
            <PublishForm tenantId={tenantId} siteId={siteId} />
          ) : null}
          <Link
            href={`/admin/tenants/${tenantId}/sites/${siteId}/preview`}
            style={{ fontSize: 13 }}
          >
            Preview draft →
          </Link>
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>History</h2>
        {history.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: 14 }}>No publications yet.</p>
        ) : (
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 20 }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: "6px 4px" }}>When</th>
                <th style={{ padding: "6px 4px" }}>Action</th>
                <th style={{ padding: "6px 4px" }}>Revision</th>
                <th style={{ padding: "6px 4px" }}>By</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "6px 4px", color: "#6b7280" }}>
                    {entry.createdAt.toISOString()}
                  </td>
                  <td style={{ padding: "6px 4px" }}>{entry.action}</td>
                  <td style={{ padding: "6px 4px" }}>#{entry.revisionNumber}</td>
                  <td style={{ padding: "6px 4px", color: "#6b7280" }}>
                    {entry.publishedByEmail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Revisions</h2>
        {revisions.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: 14 }}>
            No revisions yet — publish once to create the first one.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: "6px 4px" }}>Revision</th>
                <th style={{ padding: "6px 4px" }}>Created</th>
                <th style={{ padding: "6px 4px" }}>By</th>
                <th style={{ padding: "6px 4px" }} />
              </tr>
            </thead>
            <tbody>
              {revisions.map((revision) => (
                <tr key={revision.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "6px 4px" }}>
                    #{revision.revisionNumber}
                    {revision.id === summary.publishedRevisionId ? (
                      <span style={{ marginLeft: 6, fontSize: 11, color: "#166534" }}>(live)</span>
                    ) : null}
                  </td>
                  <td style={{ padding: "6px 4px", color: "#6b7280" }}>
                    {revision.createdAt.toISOString()}
                  </td>
                  <td style={{ padding: "6px 4px", color: "#6b7280" }}>
                    {revision.createdByEmail ?? "—"}
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    {canPublish && revision.id !== summary.publishedRevisionId ? (
                      <RollbackForm
                        tenantId={tenantId}
                        siteId={siteId}
                        targetRevisionId={revision.id}
                        targetRevisionNumber={revision.revisionNumber}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
