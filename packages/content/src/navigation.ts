import { z } from "zod";
import { safeHrefSchema, uuidSchema } from "@provence360/validation";
import { localizedStringSchema, type LocalizedString } from "./localized-string";

// The Draft-side Site Composition contract's navigation model (v0.5,
// section 5 of the brief) — replaces the previously-opaque
// `SiteSnapshot["site"]["navigation"]: unknown` with a real, closed,
// runtime-validated shape. Internal links reference a Page by its stable
// `id`, never by `slug`: a Draft author renaming a Page's slug must never
// silently break (or silently re-target) a nav item written before the
// rename — resolving a `pageId` to an actual route only happens once, at
// publish time (see `packages/publishing/src/site-snapshot.ts`'s
// `resolveNavigation`), which is what lets an already-published Revision
// stay byte-for-byte frozen even after the Draft's Page slugs change out
// from under it.
//
// Deliberately small (section 5: "we're building the kernel, not a
// mega-CMS"): two levels of nesting, a bounded number of items, a closed
// set of target kinds. `safeHrefSchema` (already used by every other
// link-shaped block prop — Hero's `ctaHref`, CTA's `buttonHref`) is reused
// as-is for the external target's `href`, so an external nav link is
// governed by the exact same protocol allowlist (relative path, same-page
// fragment, or absolute http(s)) as every other link in this codebase —
// never a second, parallel URL-safety rule.

export const NAVIGATION_SCHEMA_VERSION = 1 as const;

const MAX_ITEM_ID_LENGTH = 64;
const MAX_TOP_LEVEL_ITEMS = 30;
const MAX_CHILDREN_PER_ITEM = 20;
const MAX_TOTAL_ITEMS = 60;
/** Top-level items are depth 0; one level of children is depth 1. */
const MAX_DEPTH = 1;

const navigationItemIdSchema = z.string().trim().min(1).max(MAX_ITEM_ID_LENGTH);

export const navigationInternalTargetSchema = z.object({
  kind: z.literal("page"),
  pageId: uuidSchema,
});
export type NavigationInternalTarget = z.infer<typeof navigationInternalTargetSchema>;

export const navigationExternalTargetSchema = z.object({
  kind: z.literal("external"),
  href: safeHrefSchema,
  newTab: z.boolean().optional(),
});
export type NavigationExternalTarget = z.infer<typeof navigationExternalTargetSchema>;

export const navigationTargetSchema = z.discriminatedUnion("kind", [
  navigationInternalTargetSchema,
  navigationExternalTargetSchema,
]);
export type NavigationTarget = z.infer<typeof navigationTargetSchema>;

export interface NavigationItem {
  id: string;
  label: LocalizedString;
  target: NavigationTarget;
  /** Always an array (never absent) — a Draft item with no children normalizes to `[]` at parse time; see `walkNavigationTree` below for why "no children key" and "empty children" must not be two distinguishable shapes. */
  children: NavigationItem[];
}

// `z.lazy` for the self-reference; the explicit `z.ZodType<NavigationItem>`
// annotation is what lets TypeScript infer a non-`any` recursive type here
// instead of falling back to `any` (Zod cannot infer a recursive type on
// its own — see https://zod.dev/?id=recursive-types). `children` uses
// `.default([])` rather than `.optional()` specifically so the *inferred
// output* type is a required `NavigationItem[]`, never `T | undefined` —
// this project's `exactOptionalPropertyTypes` tsconfig setting otherwise
// rejects a hand-written recursive interface's optional property as
// incompatible with what Zod infers for `.optional()`.
const navigationItemSchema: z.ZodType<NavigationItem> = z.lazy(() =>
  z.object({
    id: navigationItemIdSchema,
    label: localizedStringSchema,
    target: navigationTargetSchema,
    children: z.array(navigationItemSchema).max(MAX_CHILDREN_PER_ITEM).default([]),
  }),
);

/**
 * Walks the tree once to enforce the invariants a purely-recursive Zod
 * shape can't express on its own: a maximum nesting depth, a maximum total
 * item count across the whole tree (not just per level), and globally
 * unique item ids (an id repeated across two different branches is just as
 * much a bug as one repeated as siblings — a duplicate id is ambiguous the
 * moment anything ever needs to address "the nav item with this id",
 * e.g. a future admin edit-in-place UI).
 */
function walkNavigationTree(
  items: readonly NavigationItem[],
  depth: number,
  seenIds: Set<string>,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): number {
  let count = 0;
  items.forEach((item, index) => {
    count += 1;
    const itemPath = [...path, index];
    if (seenIds.has(item.id)) {
      ctx.addIssue({
        code: "custom",
        message: `Duplicate navigation item id "${item.id}"`,
        path: [...itemPath, "id"],
      });
    }
    seenIds.add(item.id);

    if (item.children && item.children.length > 0) {
      if (depth + 1 > MAX_DEPTH) {
        ctx.addIssue({
          code: "custom",
          message: `Navigation nesting exceeds the maximum depth of ${String(MAX_DEPTH + 1)} levels`,
          path: [...itemPath, "children"],
        });
      } else {
        count += walkNavigationTree(item.children, depth + 1, seenIds, ctx, [
          ...itemPath,
          "children",
        ]);
      }
    }
  });
  return count;
}

export const navigationSchema = z
  .object({
    version: z.literal(NAVIGATION_SCHEMA_VERSION),
    items: z.array(navigationItemSchema).max(MAX_TOP_LEVEL_ITEMS),
  })
  .superRefine((nav, ctx) => {
    const seenIds = new Set<string>();
    const total = walkNavigationTree(nav.items, 0, seenIds, ctx, ["items"]);
    if (total > MAX_TOTAL_ITEMS) {
      ctx.addIssue({
        code: "custom",
        message: `Navigation has ${String(total)} items in total, exceeding the maximum of ${String(MAX_TOTAL_ITEMS)}`,
        path: ["items"],
      });
    }
  });

export type Navigation = z.infer<typeof navigationSchema>;

export const EMPTY_NAVIGATION: Navigation = { version: NAVIGATION_SCHEMA_VERSION, items: [] };

/**
 * Parses a Site's raw `navigation` column value as a Draft-side
 * {@link Navigation}. Tolerates exactly one legacy shape: the column's own
 * pre-v0.5 default (`jsonb("navigation").default([])`, a bare empty
 * array) — every Site created before v0.5 has this literal value, since no
 * write path for `navigation` existed until {@link navigationSchema}
 * shipped (see docs/SITE_DOMAIN.md's own admission that navigation was
 * "intentionally loose... matching how little uses it today"). Normalizing
 * that one specific legacy value to {@link EMPTY_NAVIGATION} is not a
 * fallback that hides real invalid data: any other malformed value (a
 * non-empty legacy array, garbage, `null`) still fails loudly via
 * `navigationSchema`'s own errors — there is no silent "when in doubt,
 * treat as empty."
 */
export function parseDraftNavigation(raw: unknown): Navigation {
  if (Array.isArray(raw) && raw.length === 0) return EMPTY_NAVIGATION;
  return navigationSchema.parse(raw);
}
