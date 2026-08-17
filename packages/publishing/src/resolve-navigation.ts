import type { Navigation, NavigationItem } from "@provence360/content";
import type { PublishValidationIssue } from "./errors";
import type {
  ResolvedNavigation,
  ResolvedNavigationItem,
  ResolvedNavigationTarget,
} from "./site-snapshot";

export interface PublishablePage {
  id: string;
  slug: string;
}

export interface NavigationResolution {
  navigation: ResolvedNavigation;
  issues: PublishValidationIssue[];
}

/**
 * Resolves a Draft's `pageId`-addressed {@link Navigation} into the
 * `slug`-addressed {@link ResolvedNavigation} a Revision snapshot freezes
 * (section 6 of the v0.5 brief). `publishablePages` is the exact same
 * in-memory list `assembleDraft` already loaded for its own page loop —
 * this function issues no query of its own, which is what keeps the whole
 * validate+assemble pass a single, race-safe read
 * (docs/PUBLISHING.md#concurrency): a pageId is either found in *this*
 * already-consistent snapshot of the Site's pages or it isn't, there is no
 * second, later lookup a concurrent edit could land between.
 *
 * A `pageId` that isn't in `publishablePages` — because it doesn't exist,
 * belongs to a different Site or Tenant, or names a Page that is
 * draft/archived (and therefore excluded from this publish) — is a single
 * `navigation_page_not_found` issue; these three causes are
 * indistinguishable by construction (`publishablePages` is already scoped
 * to this Site/Tenant's *active* Pages only), the same "absent, not a
 * leak" contract every other tenant-scoped lookup in this codebase uses.
 */
export function resolveNavigation(
  draft: Navigation,
  publishablePages: readonly PublishablePage[],
): NavigationResolution {
  const slugByPageId = new Map(publishablePages.map((page) => [page.id, page.slug]));
  const issues: PublishValidationIssue[] = [];

  function resolveItem(item: NavigationItem): ResolvedNavigationItem {
    let target: ResolvedNavigationTarget;
    if (item.target.kind === "page") {
      const slug = slugByPageId.get(item.target.pageId);
      if (slug === undefined) {
        issues.push({
          code: "navigation_page_not_found",
          message: `Navigation item "${item.id}" targets a page that isn't a publishable page of this site.`,
        });
        target = { kind: "page", slug: "" };
      } else {
        target = { kind: "page", slug };
      }
    } else {
      target = item.target;
    }
    return {
      id: item.id,
      label: item.label,
      target,
      children: item.children.map(resolveItem),
    };
  }

  return { navigation: { items: draft.items.map(resolveItem) }, issues };
}
