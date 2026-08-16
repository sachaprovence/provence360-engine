import { and, asc, eq } from "drizzle-orm";
import type { AppTx, PageType } from "@provence360/database";
import { pages, sites } from "@provence360/database";
import {
  MalformedBlockEnvelopeError,
  parsePageContentStrict,
  type ParsedBlock,
  type Seo,
} from "@provence360/content";
import { getTheme, resolveTheme, type ThemeTokens } from "@provence360/themes";
import { requireCurrentTenantId } from "@provence360/tenant";
import type { PublishValidationIssue } from "./errors";
import { SiteNotFoundError } from "./errors";

export interface SiteSnapshotPage {
  slug: string;
  internalName: string;
  pageType: PageType;
  seo: Seo;
  content: ParsedBlock[];
}

export interface SiteSnapshot {
  site: {
    name: string;
    publicName: string | null;
    timezone: string;
    defaultLocale: string;
    enabledLocales: string[];
    contactEmail: string | null;
    contactPhone: string | null;
    navigation: unknown;
    features: Record<string, unknown>;
  };
  theme: {
    themeId: string | null;
    tokens: ThemeTokens;
  };
  pages: SiteSnapshotPage[];
}

export type DraftAssembly =
  { valid: true; snapshot: SiteSnapshot } | { valid: false; issues: PublishValidationIssue[] };

/**
 * The single pass that both validates a Site's draft and builds the
 * immutable snapshot a Revision freezes — one function, not two, so
 * validating and snapshotting always see the *same* read of each Page's
 * content (see docs/PUBLISHING.md#concurrency for why running them as
 * separate queries would open a race: a concurrent edit could land between
 * a "validate" pass and a later "snapshot" pass under READ COMMITTED).
 *
 * What gets frozen into `snapshot`: the Site's presentation fields, its
 * fully *resolved* theme tokens (never a live `themeId` reference — a
 * later re-theme can't retroactively change how an already-published
 * Revision looked), and every "active" Page's content, ordered by slug for
 * a deterministic document (Postgres gives no row-order guarantee without
 * ORDER BY, and a non-deterministic snapshot would make "does this site
 * have unpublished changes" flap on every check). Draft/archived Pages are
 * excluded — `pageStatusValues` already exists precisely so an author can
 * keep a Page out of the next publish.
 *
 * Deliberately does NOT touch Property/Unit/Amenity data — see
 * docs/SITE_DOMAIN.md#future-release-compatibility: a PropertySummary/
 * UnitGrid/Amenities block always renders *today's* live business data,
 * even under an old Revision, the same way a printed brochure's phone
 * number isn't "frozen" by being printed. The public runtime still needs a
 * tenant-scoped `tx` to render those blocks — see apps/web's SitePage.
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

  let hasHomePage = false;
  for (const page of activePages) {
    if (page.pageType === "home") hasHomePage = true;
    try {
      const content = parsePageContentStrict(page.content);
      snapshotPages.push({
        slug: page.slug,
        internalName: page.internalName,
        pageType: page.pageType,
        seo: page.seo as Seo,
        content,
      });
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

  let tokens: ThemeTokens;
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

  if (issues.length > 0) return { valid: false, issues };

  return {
    valid: true,
    snapshot: {
      site: {
        name: site.name,
        publicName: site.publicName,
        timezone: site.timezone,
        defaultLocale: site.defaultLocale,
        enabledLocales: site.enabledLocales as string[],
        contactEmail: site.contactEmail,
        contactPhone: site.contactPhone,
        navigation: site.navigation,
        features: site.features as Record<string, unknown>,
      },
      theme: {
        themeId: site.themeId,
        tokens,
      },
      pages: snapshotPages,
    },
  };
}
