import type { AppTx } from "@provence360/database";
import {
  extractBlockReferences,
  listMediaAssetsByIds,
  type ParsedBlock,
  type Seo,
} from "@provence360/content";
import { getProperty, getUnit } from "@provence360/rentals";
import type { PublishValidationIssue } from "./errors";
import type { MediaDescriptor } from "./site-snapshot";

export interface CollectedReferences {
  mediaIds: Set<string>;
  domainRefs: { domainType: "property" | "unit"; id: string }[];
}

/**
 * Walks every publishable Page's parsed content plus its SEO field for
 * external references, using each Block's own `references` declaration
 * (`packages/content`'s `extractBlockReferences`) rather than a central
 * switch that would need updating for every new block type (section 8 of
 * the v0.5 brief).
 */
export function collectReferences(
  pages: ReadonlyArray<{ content: readonly ParsedBlock[]; seo: Seo }>,
): CollectedReferences {
  const mediaIds = new Set<string>();
  const domainRefs: { domainType: "property" | "unit"; id: string }[] = [];

  for (const page of pages) {
    for (const block of page.content) {
      for (const ref of extractBlockReferences(block)) {
        if (ref.kind === "media") {
          mediaIds.add(ref.id);
        } else if (ref.kind === "domain" && ref.domainType) {
          domainRefs.push({ domainType: ref.domainType, id: ref.id });
        }
      }
    }
    if (page.seo.ogImageMediaId) mediaIds.add(page.seo.ogImageMediaId);
  }

  return { mediaIds, domainRefs };
}

/**
 * Resolves every referenced media id under the current tenant context and
 * builds the frozen, deduplicated, deterministically-ordered (sorted by
 * id) manifest a v2 Revision snapshot holds (section 9 of the brief).
 *
 * Unlike the *render-time* "a stale/cross-tenant media id resolves to
 * nothing, degrade gracefully" contract `hero`/`gallery` already use
 * (docs/RENDERING.md#error-handling), a reference that doesn't resolve
 * here is a publish-blocking issue, never a silent omission: once frozen,
 * a Revision can never be fixed in place (it's immutable), so a broken
 * reference must be caught before it's ever frozen, not discovered by a
 * visitor loading a missing image forever after.
 */
export async function resolveMediaManifest(
  tx: AppTx,
  mediaIds: ReadonlySet<string>,
): Promise<{ media: MediaDescriptor[]; issues: PublishValidationIssue[] }> {
  if (mediaIds.size === 0) return { media: [], issues: [] };

  const ids = [...mediaIds].sort();
  const rows = await listMediaAssetsByIds(tx, ids);
  const found = new Map(rows.map((row) => [row.id, row]));

  const issues: PublishValidationIssue[] = [];
  const media: MediaDescriptor[] = [];
  for (const id of ids) {
    const row = found.get(id);
    if (!row) {
      issues.push({
        code: "media_reference_missing",
        message: `Referenced media asset "${id}" was not found (or does not belong to this tenant).`,
      });
      continue;
    }
    media.push({
      id: row.id,
      kind: row.kind,
      storageKey: row.storageKey,
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      altText: row.altText,
    });
  }
  return { media, issues };
}

/**
 * Publish-time existence/tenant check for domain-bound block references
 * (section 10 of the brief) — deliberately not a freeze. Property/Unit
 * data stays entirely live (docs/SITE_DOMAIN.md#future-release-compatibility);
 * nothing returned here is copied into the snapshot, this only catches a
 * manifestly broken or cross-tenant reference *before* it's frozen into a
 * Revision that would otherwise always render `DomainReferenceUnavailable`
 * for that block, for as long as that Revision is ever published.
 */
export async function validateDomainReferences(
  tx: AppTx,
  domainRefs: readonly { domainType: "property" | "unit"; id: string }[],
): Promise<PublishValidationIssue[]> {
  const issues: PublishValidationIssue[] = [];
  const checked = new Map<string, boolean>();

  for (const ref of domainRefs) {
    const key = `${ref.domainType}:${ref.id}`;
    if (checked.has(key)) continue;
    // Sequential on purpose: publish is not a hot path, and each check is
    // a single indexed row lookup — no batching benefit worth the added
    // complexity here (unlike media, which batches into one IN (...) query).
    const row =
      ref.domainType === "property" ? await getProperty(tx, ref.id) : await getUnit(tx, ref.id);
    checked.set(key, row !== null);
  }

  for (const [key, exists] of checked) {
    if (exists) continue;
    const [domainType, id] = key.split(":") as ["property" | "unit", string];
    issues.push({
      code: "domain_reference_missing",
      message: `Referenced ${domainType} "${id}" was not found (or does not belong to this tenant).`,
    });
  }
  return issues;
}
