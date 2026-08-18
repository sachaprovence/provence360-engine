import { eq } from "drizzle-orm";
import type { AppTx } from "@provence360/database";
import { siteRevisions } from "@provence360/database";
import { parsePageContentStrict, listPagesForSite, type Seo } from "@provence360/content";
import { listSites } from "@provence360/sites";
import { resolveSiteBranding } from "@provence360/themes";
import { requireCurrentTenantId } from "@provence360/tenant";
import { collectReferences } from "./media-manifest";

/**
 * One place a MediaAsset can be referenced from, for a human-readable
 * safety report (brief §8). `draft_page`/`site_branding` are *live*,
 * currently-editable state; `revision` is a frozen, immutable historical
 * Revision — a MediaAsset referenced only by an old (not currently
 * published) Revision is still unsafe to delete, because a rollback (see
 * `packages/publishing/src/rollback.ts`) can make any past Revision live
 * again at any time, and a deleted MediaAsset would leave that revision's
 * `<img>` permanently broken from the moment it did.
 */
export type MediaReferenceLocation =
  | { kind: "draft_page"; siteId: string; pageId: string }
  | { kind: "site_branding"; siteId: string }
  | { kind: "revision"; siteId: string; revisionId: string; revisionNumber: number };

export interface MediaSafetyReport {
  /** True only when NOTHING below references the asset — see this module's own doc comment for why every one of these must be checked. */
  safe: boolean;
  referencedBy: MediaReferenceLocation[];
}

/**
 * "Can this MediaAsset be safely deleted?" (brief §8) — the domain
 * primitive a future delete action would consult before ever calling
 * `deleteMediaAsset` (packages/content), which itself performs an
 * unconditional hard delete with no safety check of its own. Not wired to
 * any UI here (the brief: "pas nécessairement une UI de suppression") —
 * this is the callable check itself.
 *
 * Extends the *existing* reference/manifest abstraction
 * (`collectReferences`, already used at publish time to freeze a
 * Revision's media manifest) rather than building a second, parallel
 * reference-counting system — the same block-type-agnostic
 * `extractBlockReferences` mechanism that already knows how to find a
 * media id inside a Hero/Gallery/VirtualTour-poster block.
 *
 * Deliberately conservative (brief: "préfère les faux négatifs aux faux
 * positifs" — prefer refusing a safe deletion over deleting something
 * still needed): checks, for *every* Site in the tenant (a MediaAsset is
 * tenant-scoped, not site-scoped — nothing stops one from being reused
 * across Sites) —
 *
 *  1. every Page's current content (any status: draft/active/archived —
 *     an archived Page can be reactivated, its content is still "the
 *     current draft" in every sense that matters here) and SEO og:image,
 *  2. the Site's current branding (logo/logoDark/favicon),
 *  3. every historical `site_revisions` row's frozen `snapshot.media`
 *     manifest, published-and-current or not (see this module's own type
 *     doc comment on `"revision"`).
 *
 * A page whose content fails to parse is treated as "cannot prove this is
 * safe" (reported, not silently skipped) — the same fail-closed instinct
 * as everything else here.
 */
export async function isMediaAssetSafeToDelete(
  tx: AppTx,
  mediaAssetId: string,
): Promise<MediaSafetyReport> {
  const tenantId = requireCurrentTenantId();
  const referencedBy: MediaReferenceLocation[] = [];

  const siteRows = await listSites(tx);
  for (const site of siteRows) {
    const pageRows = await listPagesForSite(tx, site.id);
    for (const page of pageRows) {
      let mediaIds: ReadonlySet<string>;
      try {
        const content = parsePageContentStrict(page.content);
        const seo = page.seo as Seo;
        mediaIds = collectReferences([{ content, seo }]).mediaIds;
      } catch {
        // Content that fails to parse could reference anything — never
        // silently treated as "doesn't reference this asset."
        referencedBy.push({ kind: "draft_page", siteId: site.id, pageId: page.id });
        continue;
      }
      if (mediaIds.has(mediaAssetId)) {
        referencedBy.push({ kind: "draft_page", siteId: site.id, pageId: page.id });
      }
    }

    const brand = resolveSiteBranding(site.branding).brand;
    const brandMediaIds = [brand.logo?.mediaId, brand.logoDark?.mediaId, brand.favicon?.mediaId];
    if (brandMediaIds.includes(mediaAssetId)) {
      referencedBy.push({ kind: "site_branding", siteId: site.id });
    }
  }

  const revisionRows = await tx
    .select({
      id: siteRevisions.id,
      siteId: siteRevisions.siteId,
      revisionNumber: siteRevisions.revisionNumber,
      snapshot: siteRevisions.snapshot,
    })
    .from(siteRevisions)
    .where(eq(siteRevisions.tenantId, tenantId));

  for (const revision of revisionRows) {
    const media = (revision.snapshot as { media?: { id: string }[] } | null)?.media ?? [];
    if (media.some((entry) => entry.id === mediaAssetId)) {
      referencedBy.push({
        kind: "revision",
        siteId: revision.siteId,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
      });
    }
  }

  return { safe: referencedBy.length === 0, referencedBy };
}
