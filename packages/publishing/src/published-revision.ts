import { and, eq } from "drizzle-orm";
import type { AppTx } from "@provence360/database";
import { siteRevisions, sites } from "@provence360/database";
import { requireCurrentTenantId } from "@provence360/tenant";
import type { SiteSnapshot } from "./draft-snapshot";

export interface PublishedRevisionResult {
  revisionId: string;
  revisionNumber: number;
  snapshot: SiteSnapshot;
}

/**
 * The public runtime's one read (`Host -> DomainResolver -> Site ->
 * Published Revision -> Renderer` — see docs/PUBLISHING.md). Reads
 * `sites.published_revision_id` — the single source of truth for "what's
 * live right now" — and the immutable Revision it points at. Never reads
 * `pages`/draft data directly; the public site can render *only* what a
 * past `publishSite`/`rollbackSite` call froze.
 *
 * Returns `null` when the Site has never been published. The caller
 * (apps/web) must render that deterministically (404 — the same response
 * already used for "no home page" pre-v0.4, so this adds no new
 * distinguishable signal a visitor could use to tell "never published"
 * apart from "domain doesn't resolve") — never a fallback to draft
 * content (Invariant A/B).
 */
export async function getPublishedRevision(
  tx: AppTx,
  siteId: string,
): Promise<PublishedRevisionResult | null> {
  const tenantId = requireCurrentTenantId();

  const [site] = await tx
    .select({ publishedRevisionId: sites.publishedRevisionId })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)));
  if (!site?.publishedRevisionId) return null;

  const [revision] = await tx
    .select()
    .from(siteRevisions)
    .where(
      and(eq(siteRevisions.id, site.publishedRevisionId), eq(siteRevisions.tenantId, tenantId)),
    );
  // Revisions are never deleted (no DELETE policy — see schema.ts), so a
  // dangling pointer should be unreachable. Fail closed rather than throw:
  // a rendering path silently doing the wrong thing is worse than a 404.
  if (!revision) return null;

  return {
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    snapshot: revision.snapshot as SiteSnapshot,
  };
}
