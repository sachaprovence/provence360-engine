import { and, eq, sql } from "drizzle-orm";
import type { AppTx } from "@provence360/database";
import { siteRevisions, sites } from "@provence360/database";
import { logger, recordAuditLog } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import { assembleDraft } from "./draft-snapshot";
import { PublishValidationError, SiteNotFoundError } from "./errors";

export interface CreateRevisionFromDraftInput {
  siteId: string;
  actorUserId?: string;
}

/**
 * Freezes the Site's current draft into a brand-new, immutable Revision.
 * Never publishes it — that's `publishSite`'s job (which calls this, then
 * `publishRevision`). Transactional, tenant-safe, and race-safe under
 * concurrent callers on the *same* Site: `SELECT ... FOR UPDATE` on the
 * Site row (same pattern as `assertNotLastOwner` in
 * packages/auth/src/membership-repository.ts) serializes them, so two
 * concurrent "create a revision for Site X" calls can never compute the
 * same `revisionNumber` — the second one blocks until the first commits,
 * then correctly sees `max(revisionNumber) + 1` including the first's new
 * row. The `site_revisions_site_number_uidx` unique index is the
 * database-level backstop, not the primary mechanism.
 */
export async function createRevisionFromDraft(tx: AppTx, input: CreateRevisionFromDraftInput) {
  const tenantId = requireCurrentTenantId();
  const { siteId, actorUserId } = input;

  const [lockedSite] = await tx
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    .for("update");
  if (!lockedSite) throw new SiteNotFoundError(siteId);

  const assembly = await assembleDraft(tx, siteId);
  if (!assembly.valid) {
    logger.warn("publishing.revision.validation_failed", {
      tenantId,
      siteId,
      issues: assembly.issues.map((issue) => issue.code),
    });
    throw new PublishValidationError(assembly.issues);
  }

  const [maxRow] = await tx
    .select({ maxNumber: sql<number>`coalesce(max(${siteRevisions.revisionNumber}), 0)` })
    .from(siteRevisions)
    .where(and(eq(siteRevisions.siteId, siteId), eq(siteRevisions.tenantId, tenantId)));
  const revisionNumber = Number(maxRow?.maxNumber ?? 0) + 1;

  const [revision] = await tx
    .insert(siteRevisions)
    .values({
      tenantId,
      siteId,
      revisionNumber,
      snapshot: assembly.snapshot,
      createdByUserId: actorUserId,
    })
    .returning();
  if (!revision) throw new Error("Failed to create revision");

  logger.info("publishing.revision.created", {
    tenantId,
    siteId,
    revisionId: revision.id,
    revisionNumber,
  });
  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: "SITE_REVISION_CREATED",
    targetType: "site_revision",
    targetId: revision.id,
    metadata: { siteId, revisionNumber },
  });

  return revision;
}
