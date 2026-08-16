import { and, desc, eq } from "drizzle-orm";
import type { AppTx } from "@provence360/database";
import { siteRevisions, sitePublications, sites, users } from "@provence360/database";
import { requireCurrentTenantId } from "@provence360/tenant";
import { assembleDraft, type SiteSnapshot } from "./draft-snapshot";
import type { PublishValidationIssue } from "./errors";
import { SiteNotFoundError } from "./errors";
import { snapshotsEqual } from "./snapshot-equal";

export interface DraftSummary {
  publishedRevisionId: string | null;
  publishedRevisionNumber: number | null;
  publishedAt: Date | null;
  publishedByUserId: string | null;
  hasUnpublishedChanges: boolean;
  /** Non-empty only when the current draft would fail publish validation right now. */
  issues: readonly PublishValidationIssue[];
}

/**
 * "Does this Site have unpublished changes, and what's currently live?" —
 * the read the admin dashboard needs before showing a Publish button.
 * `hasUnpublishedChanges` is a structural comparison (deep-equal on the
 * same snapshot shape a Revision would freeze), not a timestamp heuristic:
 * a Site that's never been published has changes to publish the moment it
 * has at least one Page; a Site whose draft currently fails validation is
 * always reported as having changes (there is something to fix, so
 * "nothing to publish" would be misleading) — see `issues`.
 */
export async function getDraftSummary(tx: AppTx, siteId: string): Promise<DraftSummary> {
  const tenantId = requireCurrentTenantId();

  const [site] = await tx
    .select({ id: sites.id, publishedRevisionId: sites.publishedRevisionId })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)));
  if (!site) throw new SiteNotFoundError(siteId);

  const assembly = await assembleDraft(tx, siteId);

  let publishedSnapshot: SiteSnapshot | null = null;
  let publishedRevisionNumber: number | null = null;
  if (site.publishedRevisionId) {
    const [revision] = await tx
      .select({ snapshot: siteRevisions.snapshot, revisionNumber: siteRevisions.revisionNumber })
      .from(siteRevisions)
      .where(
        and(eq(siteRevisions.id, site.publishedRevisionId), eq(siteRevisions.tenantId, tenantId)),
      );
    if (revision) {
      publishedSnapshot = revision.snapshot as SiteSnapshot;
      publishedRevisionNumber = revision.revisionNumber;
    }
  }

  const latestPublication = site.publishedRevisionId
    ? (
        await tx
          .select({
            createdAt: sitePublications.createdAt,
            publishedByUserId: sitePublications.publishedByUserId,
          })
          .from(sitePublications)
          .where(
            and(
              eq(sitePublications.siteId, siteId),
              eq(sitePublications.tenantId, tenantId),
              eq(sitePublications.revisionId, site.publishedRevisionId),
            ),
          )
          .orderBy(desc(sitePublications.createdAt))
          .limit(1)
      )[0]
    : undefined;

  const hasUnpublishedChanges = !assembly.valid
    ? true
    : publishedSnapshot === null
      ? assembly.snapshot.pages.length > 0
      : !snapshotsEqual(assembly.snapshot, publishedSnapshot);

  return {
    publishedRevisionId: site.publishedRevisionId,
    publishedRevisionNumber,
    publishedAt: latestPublication?.createdAt ?? null,
    publishedByUserId: latestPublication?.publishedByUserId ?? null,
    hasUnpublishedChanges,
    issues: assembly.valid ? [] : assembly.issues,
  };
}

export interface RevisionSummary {
  id: string;
  revisionNumber: number;
  createdAt: Date;
  createdByUserId: string | null;
  createdByEmail: string | null;
}

/** Every Revision ever created for a Site, newest first — the admin's rollback picker. */
export async function listRevisions(tx: AppTx, siteId: string): Promise<RevisionSummary[]> {
  const tenantId = requireCurrentTenantId();
  return tx
    .select({
      id: siteRevisions.id,
      revisionNumber: siteRevisions.revisionNumber,
      createdAt: siteRevisions.createdAt,
      createdByUserId: siteRevisions.createdByUserId,
      createdByEmail: users.email,
    })
    .from(siteRevisions)
    .leftJoin(users, eq(users.id, siteRevisions.createdByUserId))
    .where(and(eq(siteRevisions.siteId, siteId), eq(siteRevisions.tenantId, tenantId)))
    .orderBy(desc(siteRevisions.revisionNumber));
}

export interface PublicationHistoryEntry {
  id: string;
  revisionId: string;
  revisionNumber: number;
  previousRevisionId: string | null;
  action: "publish" | "rollback";
  createdAt: Date;
  publishedByUserId: string | null;
  publishedByEmail: string | null;
}

/** The full publish/rollback history for a Site, newest first. */
export async function listPublicationHistory(
  tx: AppTx,
  siteId: string,
): Promise<PublicationHistoryEntry[]> {
  const tenantId = requireCurrentTenantId();
  return tx
    .select({
      id: sitePublications.id,
      revisionId: sitePublications.revisionId,
      revisionNumber: siteRevisions.revisionNumber,
      previousRevisionId: sitePublications.previousRevisionId,
      action: sitePublications.action,
      createdAt: sitePublications.createdAt,
      publishedByUserId: sitePublications.publishedByUserId,
      publishedByEmail: users.email,
    })
    .from(sitePublications)
    .innerJoin(siteRevisions, eq(siteRevisions.id, sitePublications.revisionId))
    .leftJoin(users, eq(users.id, sitePublications.publishedByUserId))
    .where(and(eq(sitePublications.siteId, siteId), eq(sitePublications.tenantId, tenantId)))
    .orderBy(desc(sitePublications.createdAt));
}
