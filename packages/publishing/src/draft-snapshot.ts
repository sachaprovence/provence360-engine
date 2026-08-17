import { and, asc, eq } from "drizzle-orm";
import type { AppTx } from "@provence360/database";
import { pages, sites } from "@provence360/database";
import {
  MalformedBlockEnvelopeError,
  parseDraftNavigation,
  parsePageContentStrict,
  type ParsedBlock,
  type Seo,
} from "@provence360/content";
import { getTheme, resolveSiteBranding, resolveTheme } from "@provence360/themes";
import { requireCurrentTenantId } from "@provence360/tenant";
import type { PublishValidationIssue } from "./errors";
import { SiteNotFoundError } from "./errors";
import {
  collectReferences,
  resolveBrandMedia,
  resolveMediaManifest,
  validateDomainReferences,
} from "./media-manifest";
import { resolveNavigation } from "./resolve-navigation";
import { SNAPSHOT_SCHEMA_VERSION, type SiteSnapshot, type SiteSnapshotPage } from "./site-snapshot";

export type { SiteSnapshot, SiteSnapshotPage } from "./site-snapshot";

export type DraftAssembly =
  { valid: true; snapshot: SiteSnapshot } | { valid: false; issues: PublishValidationIssue[] };

/**
 * The single pass that both validates a Site's draft and builds the
 * immutable v2 snapshot a Revision freezes — one function, not two, so
 * validating and snapshotting always see the *same* read of each Page's
 * content, the Site's navigation, and every referenced media/domain id
 * (see docs/PUBLISHING.md#concurrency for why running these as separate
 * queries would open a race: a concurrent edit could land between a
 * "validate" pass and a later "snapshot" pass under READ COMMITTED).
 *
 * What gets frozen into `snapshot` (v0.5, section 4/7 of the brief): the
 * Site's presentation fields, its *resolved* navigation (internal links
 * pointing at a Page's `slug`, not its mutable `pageId` — see
 * `resolve-navigation.ts`), its fully *resolved* theme tokens, every
 * "active" Page's content (ordered by slug for a deterministic document),
 * and a frozen, deduplicated manifest of every MediaAsset any block/SEO
 * field on those pages references (`media-manifest.ts`). Draft/archived
 * Pages are excluded — `pageStatusValues` already exists precisely so an
 * author can keep a Page out of the next publish.
 *
 * Deliberately does NOT touch Property/Unit/Amenity data — see
 * docs/SITE_DOMAIN.md#future-release-compatibility: a PropertySummary/
 * UnitGrid/Amenities block always renders *today's* live business data,
 * even under an old Revision. Publish-time validation still confirms a
 * referenced Property/Unit id exists for this tenant (section 10 of the
 * brief) — a manifestly broken or cross-tenant reference is rejected
 * before it's frozen — but nothing about that row's own fields is copied
 * into the snapshot. The public runtime still needs a tenant-scoped `tx`
 * to render those blocks — see apps/web's SitePage.
 */
export async function assembleDraft(tx: AppTx, siteId: string): Promise<DraftAssembly> {
  const tenantId = requireCurrentTenantId();

  const [site] = await tx
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)));
  if (!site) throw new SiteNotFoundError(siteId);

  const activePages = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.siteId, siteId), eq(pages.tenantId, tenantId), eq(pages.status, "active")))
    .orderBy(asc(pages.slug));

  const issues: PublishValidationIssue[] = [];
  const snapshotPages: SiteSnapshotPage[] = [];
  const parsedByPage: { content: ParsedBlock[]; seo: Seo }[] = [];

  let hasHomePage = false;
  for (const page of activePages) {
    if (page.pageType === "home") hasHomePage = true;
    try {
      const content = parsePageContentStrict(page.content);
      const seo = page.seo as Seo;
      snapshotPages.push({
        slug: page.slug,
        internalName: page.internalName,
        pageType: page.pageType,
        seo,
        content,
      });
      parsedByPage.push({ content, seo });
    } catch (error) {
      issues.push({
        code: "invalid_page_content",
        pageId: page.id,
        message:
          error instanceof MalformedBlockEnvelopeError || error instanceof Error
            ? `Page "${page.slug || "(home)"}": ${error.message}`
            : `Page "${page.slug || "(home)"}" has invalid content.`,
      });
    }
  }

  if (!hasHomePage) {
    issues.push({
      code: "missing_home_page",
      message:
        'The site has no active home page — the public runtime has nothing to render at "/".',
    });
  }

  let tokens;
  try {
    const theme = site.themeId ? await getTheme(tx, site.themeId) : null;
    tokens = resolveTheme(theme?.tokens, site.themeOverrides);
  } catch (error) {
    issues.push({
      code: "invalid_theme",
      message:
        error instanceof Error ? `Theme: ${error.message}` : "Theme configuration is invalid.",
    });
    return { valid: false, issues };
  }

  // v0.8 — structurally invalid stored branding overrides (a corrupted
  // row, or a raw DB edit that bypassed `updateSiteBranding`'s own
  // validation) is publish-blocking, exactly like `invalid_theme` above —
  // never silently frozen as-is. A *missing* logo/favicon reference is a
  // separate, non-blocking concern handled below by `resolveBrandMedia`.
  let branding;
  try {
    branding = resolveSiteBranding(site.branding);
  } catch (error) {
    issues.push({
      code: "invalid_branding",
      message:
        error instanceof Error
          ? `Branding: ${error.message}`
          : "Branding configuration is invalid.",
    });
    return { valid: false, issues };
  }

  // Navigation: structural parse, then resolve pageId -> slug against the
  // exact same in-memory list of this Site's active Pages loaded above —
  // no second query (see this function's own docstring on why).
  const publishablePages = activePages.map((page) => ({ id: page.id, slug: page.slug }));
  let resolvedNavigation;
  try {
    const draftNavigation = parseDraftNavigation(site.navigation);
    const resolution = resolveNavigation(draftNavigation, publishablePages);
    resolvedNavigation = resolution.navigation;
    issues.push(...resolution.issues);
  } catch (error) {
    issues.push({
      code: "invalid_navigation",
      message: error instanceof Error ? `Navigation: ${error.message}` : "Navigation is invalid.",
    });
    resolvedNavigation = { items: [] };
  }

  // Media + domain references: collected from every page that parsed
  // successfully above (a page that failed to parse contributes nothing
  // to look up — its own issue already blocks the publish).
  const { mediaIds, domainRefs } = collectReferences(parsedByPage);
  const [{ media, issues: mediaIssues }, domainIssues, { brand, media: brandMedia }] =
    await Promise.all([
      resolveMediaManifest(tx, mediaIds),
      validateDomainReferences(tx, domainRefs),
      // v0.8 — deliberately NOT `resolveMediaManifest`: a missing/stale
      // logo/favicon reference degrades to "no logo" (see
      // docs/adr/0021-site-theme-branding-design-system.md), never blocks
      // publishing the whole site the way a broken content-block media
      // reference does.
      resolveBrandMedia(tx, branding.brand),
    ]);
  issues.push(...mediaIssues, ...domainIssues);

  if (issues.length > 0) return { valid: false, issues };

  // One deduplicated, id-sorted manifest — a brand logo that's ALSO used
  // as a content-block image (unlikely, but not forbidden) is frozen once,
  // not twice.
  const mediaById = new Map(media.map((descriptor) => [descriptor.id, descriptor]));
  for (const descriptor of brandMedia) mediaById.set(descriptor.id, descriptor);
  const mergedMedia = [...mediaById.values()].sort((a, b) => a.id.localeCompare(b.id));

  return {
    valid: true,
    snapshot: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      site: {
        name: site.name,
        publicName: site.publicName,
        timezone: site.timezone,
        defaultLocale: site.defaultLocale,
        enabledLocales: site.enabledLocales as string[],
        contactEmail: site.contactEmail,
        contactPhone: site.contactPhone,
        navigation: resolvedNavigation,
        features: site.features as Record<string, unknown>,
      },
      theme: {
        themeId: site.themeId,
        tokens,
      },
      branding: { ...branding, brand },
      pages: snapshotPages,
      media: mergedMedia,
    },
  };
}
