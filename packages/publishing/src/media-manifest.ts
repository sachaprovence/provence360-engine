import type { AppTx } from "@provence360/database";
import {
  extractBlockReferences,
  listMediaAssetsByIds,
  type ParsedBlock,
  type Seo,
} from "@provence360/content";
import {
  getProperty,
  getUnit,
  isPublicPropertyStatus,
  isPublicUnitStatus,
} from "@provence360/rentals";
import type { SiteBrandingBrand } from "@provence360/themes";
import {
  getVirtualTour,
  isPublicVirtualTourStatus,
  virtualTourProviderRegistry,
} from "@provence360/virtual-tours";
import type { PublishValidationIssue } from "./errors";
import type { MediaDescriptor } from "./site-snapshot";

/**
 * `media_assets.variants` is stored as `{version: 1, thumbnail?: {...},
 * ...}` (or `{}` for an asset with no generated variants — every pre-v0.9
 * row, and any non-image asset). The frozen `MediaDescriptor.variants`
 * field deliberately drops the `version` wrapper: a Revision snapshot
 * already has its own top-level `schemaVersion` governing the whole
 * document's shape (see `parseSiteSnapshot`'s upgrade chain), so a nested,
 * independently-versioned sub-object here would be a second version axis
 * with no real use — `undefined` (no variants) vs. a plain object (some
 * variants) is all a consumer ever needs to branch on.
 */
function extractVariantsForDescriptor(raw: unknown): MediaDescriptor["variants"] | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { version: _version, ...rest } = raw as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export type DomainRefType = "property" | "unit" | "virtualTour";

export interface CollectedReferences {
  mediaIds: Set<string>;
  domainRefs: { domainType: DomainRefType; id: string }[];
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
  const domainRefs: { domainType: DomainRefType; id: string }[] = [];

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
      checksumSha256: row.checksumSha256 ?? undefined,
      byteSize: row.byteSize ?? undefined,
      variants: extractVariantsForDescriptor(row.variants),
    });
  }
  return { media, issues };
}

/**
 * v0.8 — resolves a SiteBranding's `logo`/`logoDark`/`favicon` media
 * references at publish time, the same tenant-scoped `listMediaAssetsByIds`
 * lookup `resolveMediaManifest` uses, but with a deliberately different
 * failure mode: a reference that doesn't resolve (deleted, stale,
 * cross-tenant) is silently dropped from the frozen `brand` object, never
 * a publish-blocking issue — a missing logo degrades to text-only
 * branding, it doesn't stop a tenant from publishing the rest of their
 * site (docs/adr/0021-site-theme-branding-design-system.md). Contrast with
 * content-block media, which is content the visitor was promised will be
 * there; a logo is chrome, and "no logo" is always a safe, renderable
 * fallback.
 */
export async function resolveBrandMedia(
  tx: AppTx,
  brand: SiteBrandingBrand,
): Promise<{ brand: SiteBrandingBrand; media: MediaDescriptor[] }> {
  const ids = [brand.logo?.mediaId, brand.logoDark?.mediaId, brand.favicon?.mediaId].filter(
    (id): id is string => id !== undefined,
  );
  if (ids.length === 0) return { brand, media: [] };

  const rows = await listMediaAssetsByIds(tx, [...new Set(ids)].sort());
  const found = new Map(rows.map((row) => [row.id, row]));

  const media: MediaDescriptor[] = [...found.values()].map((row) => ({
    id: row.id,
    kind: row.kind,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    altText: row.altText,
    checksumSha256: row.checksumSha256 ?? undefined,
    byteSize: row.byteSize ?? undefined,
    variants: extractVariantsForDescriptor(row.variants),
  }));

  const resolvedBrand: SiteBrandingBrand = { ...brand };
  if (brand.logo && !found.has(brand.logo.mediaId)) delete resolvedBrand.logo;
  if (brand.logoDark && !found.has(brand.logoDark.mediaId)) delete resolvedBrand.logoDark;
  if (brand.favicon && !found.has(brand.favicon.mediaId)) delete resolvedBrand.favicon;

  return { brand: resolvedBrand, media };
}

type DomainRefCheck = {
  exists: boolean;
  active: boolean;
  /**
   * Defaults to `true` for Property/Unit refs, which have no equivalent
   * failure mode. Only `virtualTour` refs can be `false`: the referenced
   * row's `provider` isn't a registered {@link virtualTourProviderRegistry}
   * definition, or its stored `providerAssetId` no longer passes that
   * provider's own `validateExternalId` — see `buildSafeVirtualTourEmbed`'s
   * doc comment (`packages/virtual-tours/src/embed.ts`) for when this can
   * happen (should be extremely rare: a row predating a provider's removal
   * or a manual DB edit, never a normal write path, since `normalize()`
   * already validates at create/update time).
   */
  providerValid: boolean;
};

/**
 * Publish-time existence/tenant/status check for domain-bound block
 * references (section 10/14 of the v0.6 brief) — deliberately not a
 * freeze. Property/Unit data stays entirely live
 * (docs/SITE_DOMAIN.md#future-release-compatibility); nothing returned
 * here is copied into the snapshot, this only catches a manifestly broken,
 * cross-tenant, or non-public reference *before* it's frozen into a
 * Revision that would otherwise always render `DomainReferenceUnavailable`
 * for that block, for as long as that Revision is ever published.
 *
 * v0.6 hardening: a reference to a real, tenant-owned Property/Unit that
 * simply isn't public right now (`draft`/`archived` Property,
 * `draft`/`archived` Unit) is now also a publish-blocking issue
 * (`domain_reference_not_active`), distinct from `domain_reference_missing`
 * — v0.5's original existence+tenant-only check was not a bug relative to
 * what it explicitly documented itself as doing, but it left a real gap:
 * nothing stopped a page from being published bound to rental data that
 * would immediately render as unavailable to every visitor. This is a
 * deliberate publish-time UX improvement (fail fast, at edit time, instead
 * of silently at render time), not a correctness fix — the *runtime*
 * boundary (an already-published Revision whose referenced Property is
 * later archived) is unaffected and unchanged: presentation stays frozen,
 * the live Rental-data read simply stops returning it publicly (see
 * `packages/rentals`' `isPublicPropertyStatus`/`isPublicUnitStatus` and
 * docs/adr/0018-rental-domain-guest-experience.md).
 *
 * Deliberately NOT validated here: whether a `unit-grid` block's explicit
 * `unitIds` actually belong to its own declared `propertyId`. Adding that
 * would require this function (which only sees a flat, block-type-agnostic
 * list of `{domainType, id}` references — see `collectReferences`) to gain
 * block-type-specific knowledge, which is exactly the central-switch
 * design this reference mechanism was built to avoid (section 8 of the
 * v0.5 brief). It's safe to defer: the renderer already fails closed on
 * this case today — `unit-grid.tsx` only ever selects from Units it
 * already fetched scoped to `props.propertyId`, so a stray `unitId` from a
 * different Property simply never appears, never wrongly displayed.
 */
export async function validateDomainReferences(
  tx: AppTx,
  domainRefs: readonly { domainType: DomainRefType; id: string }[],
): Promise<PublishValidationIssue[]> {
  const issues: PublishValidationIssue[] = [];
  const checked = new Map<string, DomainRefCheck>();

  for (const ref of domainRefs) {
    const key = `${ref.domainType}:${ref.id}`;
    if (checked.has(key)) continue;
    // Sequential on purpose: publish is not a hot path, and each check is
    // a single indexed row lookup — no batching benefit worth the added
    // complexity here (unlike media, which batches into one IN (...) query).
    if (ref.domainType === "property") {
      const row = await getProperty(tx, ref.id);
      checked.set(key, {
        exists: row !== null,
        active: row !== null && isPublicPropertyStatus(row.status),
        providerValid: true,
      });
    } else if (ref.domainType === "unit") {
      const row = await getUnit(tx, ref.id);
      checked.set(key, {
        exists: row !== null,
        active: row !== null && isPublicUnitStatus(row.status),
        providerValid: true,
      });
    } else {
      const row = await getVirtualTour(tx, ref.id);
      const definition = row ? virtualTourProviderRegistry.get(row.provider) : undefined;
      checked.set(key, {
        exists: row !== null,
        active: row !== null && isPublicVirtualTourStatus(row.status),
        providerValid:
          row === null ||
          (definition !== undefined && definition.validateExternalId(row.providerAssetId)),
      });
    }
  }

  for (const [key, result] of checked) {
    const [domainType, id] = key.split(":") as [DomainRefType, string];
    if (!result.exists) {
      issues.push({
        code: "domain_reference_missing",
        message: `Referenced ${domainType} "${id}" was not found (or does not belong to this tenant).`,
      });
    } else if (!result.providerValid) {
      issues.push({
        code: "domain_reference_invalid",
        message: `Referenced ${domainType} "${id}" has a corrupted or unrecognized provider configuration and cannot be published.`,
      });
    } else if (!result.active) {
      issues.push({
        code: "domain_reference_not_active",
        message: `Referenced ${domainType} "${id}" exists but is not currently active/public — a draft or archived ${domainType} cannot be published.`,
      });
    }
  }
  return issues;
}
