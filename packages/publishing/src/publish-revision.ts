import { and, eq } from "drizzle-orm";
import type { AppTx, PublicationAction } from "@provence360/database";
import { siteRevisions, sitePublications, sites } from "@provence360/database";
import { logger, recordAuditLog } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import { RevisionNotFoundError, SiteNotFoundError } from "./errors";

export interface PublishRevisionInput {
  siteId: string;
  revisionId: string;
  action: PublicationAction;
  actorUserId?: string;
}

/**
 * The one place `sites.published_revision_id` — the single source of
 * truth for "what's live right now" (see schema.ts) — is ever written.
 * Shared by `publishSite` (a fresh Revision) and `rollbackSite` (an
 * existing, older one): both are, from this function's point of view, "make
 * this Revision the active one," differing only in the `action` recorded to
 * `site_publications` for history/provenance.
 *
 * Atomic and race-safe: `SELECT ... FOR UPDATE` on the Site row means two
 * concurrent publish/rollback attempts on the same Site serialize — the
 * second sees the first's committed pointer as `previousRevisionId`, never
 * a stale one, and the whole pointer-flip + history-insert either both
 * commit or neither does (ordinary transaction atomicity — this always
 * runs inside the caller's `withTenantContext`/`withAuthorizedTenantContext`
 * transaction, never opens its own).
 *
 * Cross-tenant-safe by construction, not by a checked `if`: `revisionId` is
 * re-read here through *this* tenant's RLS-scoped `tx` — a revision
 * belonging to a different tenant simply does not exist from this query's
 * point of view (RLS denies the row before this function ever sees its
 * id), so it is structurally impossible to ever write it into
 * `published_revision_id`. The explicit `revision.siteId === siteId` check
 * below is the second, independent layer: RLS only scopes by *tenant*, so
 * without this check a revision belonging to a *different Site in the same
 * tenant* could otherwise be published onto the wrong Site.
 */
export async function publishRevision(tx: AppTx, input: PublishRevisionInput) {
  const tenantId = requireCurrentTenantId();
  const { siteId, revisionId, action, actorUserId } = input;

  const [lockedSite] = await tx
    .select({ id: sites.id, publishedRevisionId: sites.publishedRevisionId })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    .for("update");
  if (!lockedSite) throw new SiteNotFoundError(siteId);

  const [revision] = await tx
    .select({ id: siteRevisions.id, siteId: siteRevisions.siteId })
    .from(siteRevisions)
    .where(and(eq(siteRevisions.id, revisionId), eq(siteRevisions.tenantId, tenantId)));
  if (!revision || revision.siteId !== siteId) throw new RevisionNotFoundError(revisionId);

  const previousRevisionId = lockedSite.publishedRevisionId;

  await tx
    .update(sites)
    .set({ publishedRevisionId: revisionId })
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)));

  const [publication] = await tx
    .insert(sitePublications)
    .values({
      tenantId,
      siteId,
      revisionId,
      previousRevisionId,
      action,
      publishedByUserId: actorUserId,
    })
    .returning();
  if (!publication) throw new Error("Failed to record publication");

  logger.info(`publishing.site.${action}`, {
    tenantId,
    siteId,
    revisionId,
    previousRevisionId,
  });
  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: action === "publish" ? "SITE_PUBLISHED" : "SITE_ROLLED_BACK",
    targetType: "site",
    targetId: siteId,
    metadata: { revisionId, previousRevisionId },
  });

  return publication;
}
