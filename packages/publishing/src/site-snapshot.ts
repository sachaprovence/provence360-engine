import { z } from "zod";
import { mediaKindValues, pageTypeValues } from "@provence360/database";
import { blockEnvelopeSchema, localizedStringSchema, seoSchema } from "@provence360/content";
import { safeHrefSchema, uuidSchema } from "@provence360/validation";
import {
  DEFAULT_SITE_BRANDING,
  siteBrandingV1Schema,
  themeTokensSchema,
  type SiteBrandingV1,
} from "@provence360/themes";

// The Site Composition Contract (v0.5, sections 4/7 of the brief): the
// real, runtime-validated shape of what a `site_revisions.snapshot` JSONB
// document must contain, and the one function (`parseSiteSnapshot`) every
// caller that reads a Revision back from Postgres must go through. Before
// this, `SiteSnapshot` was a bare TypeScript interface with zero runtime
// enforcement — `revision.snapshot as SiteSnapshot` (the exact "trust the
// database blindly" cast this schema replaces) appeared at both call sites
// that ever read a stored snapshot back (`getPublishedRevision`,
// `getDraftSummary`). A malformed or future-versioned document must fail
// closed here, not surface as a runtime crash three layers downstream in
// the renderer.

/** Bumped whenever the *shape* `assembleDraft` freezes into a new Revision changes incompatibly. */
export const SNAPSHOT_SCHEMA_VERSION = 3 as const;

/** The immediately-prior schema version — still readable (see `parseSiteSnapshot`'s v2 branch), never writable. */
const PREVIOUS_SNAPSHOT_SCHEMA_VERSION = 2 as const;

// --- Media -------------------------------------------------------------
//
// A frozen, self-sufficient copy of exactly the MediaAsset fields a
// renderer needs to draw an image/video — never the binary itself (section
// 9 of the brief: "ne duplique pas le fichier binaire"). Assembled once,
// at publish time, from the tenant's live `media_assets` table
// (`packages/publishing/src/media-manifest.ts`) — see that module for why
// this is what makes an already-published Revision immune to a later edit
// of the same MediaAsset row's `altText`/`storageKey`/etc.

export const mediaDescriptorSchema = z.object({
  id: uuidSchema,
  kind: z.enum(mediaKindValues),
  storageKey: z.string(),
  mimeType: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  altText: z.string().nullable(),
});
export type MediaDescriptor = z.infer<typeof mediaDescriptorSchema>;

// --- Resolved navigation -------------------------------------------------
//
// The *published* counterpart of `packages/content`'s Draft-side
// `Navigation`/`NavigationItem` (`navigation.ts`) — same tree shape, but
// an internal target holds the Page's resolved `slug` at publish time
// instead of a `pageId` a future Draft edit could still move. See
// `resolve-navigation.ts`'s `resolveNavigation` for where a Draft
// `Navigation` becomes a `ResolvedNavigation` (section 6 of the brief:
// "au publish, les références internes doivent être résolues").

export const resolvedNavigationInternalTargetSchema = z.object({
  kind: z.literal("page"),
  slug: z.string(),
});
export const resolvedNavigationExternalTargetSchema = z.object({
  kind: z.literal("external"),
  href: safeHrefSchema,
  newTab: z.boolean().optional(),
});
export const resolvedNavigationTargetSchema = z.discriminatedUnion("kind", [
  resolvedNavigationInternalTargetSchema,
  resolvedNavigationExternalTargetSchema,
]);
export type ResolvedNavigationTarget = z.infer<typeof resolvedNavigationTargetSchema>;

export interface ResolvedNavigationItem {
  id: string;
  label: z.infer<typeof localizedStringSchema>;
  target: ResolvedNavigationTarget;
  /** Always an array — see `packages/content/src/navigation.ts`'s `NavigationItem.children` for why. */
  children: ResolvedNavigationItem[];
}

const resolvedNavigationItemSchema: z.ZodType<ResolvedNavigationItem> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: localizedStringSchema,
    target: resolvedNavigationTargetSchema,
    children: z.array(resolvedNavigationItemSchema).default([]),
  }),
);

export const resolvedNavigationSchema = z.object({
  items: z.array(resolvedNavigationItemSchema),
});
export type ResolvedNavigation = z.infer<typeof resolvedNavigationSchema>;

export const EMPTY_RESOLVED_NAVIGATION: ResolvedNavigation = { items: [] };

// --- The snapshot itself --------------------------------------------------

export const siteSnapshotPageSchema = z.object({
  slug: z.string(),
  internalName: z.string(),
  pageType: z.enum(pageTypeValues),
  seo: seoSchema,
  // Structural shape only (the block envelope) — full per-type prop
  // validation happens where it already did pre-v0.5, at render time via
  // `renderBlocks`' own `parseBlockInstance` call (docs/RENDERING.md):
  // duplicating that validation here would be two places disagreeing
  // about the same rule as the Block Registry evolves (ADR 0014).
  content: z.array(blockEnvelopeSchema),
});
export type SiteSnapshotPage = z.infer<typeof siteSnapshotPageSchema>;

export const siteSnapshotSiteSchema = z.object({
  name: z.string(),
  publicName: z.string().nullable(),
  timezone: z.string(),
  defaultLocale: z.string(),
  enabledLocales: z.array(z.string()),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  navigation: resolvedNavigationSchema,
  features: z.record(z.string(), z.unknown()),
});

export const siteSnapshotThemeSchema = z.object({
  themeId: uuidSchema.nullable(),
  tokens: themeTokensSchema,
});

/**
 * `media` is a frozen manifest — every `MediaDescriptor` any block/SEO
 * field in `pages` (and, v0.8, `branding.brand.logo`/`logoDark`/`favicon`)
 * references, deduplicated, ordered by `id` (determinism — section 14 of
 * the brief). Always present (possibly empty) on a Revision created by
 * v0.5+'s `assembleDraft`; `undefined` is reserved for a *normalized
 * legacy* (pre-v0.5) snapshot that never had one at all — see
 * `parseSiteSnapshot`'s legacy branch and `docs/PUBLISHING.md`'s "Media"
 * section for why that distinction (not just "always an array") matters
 * for how the renderer treats each case differently.
 */
const siteSnapshotV2Schema = z.object({
  schemaVersion: z.literal(PREVIOUS_SNAPSHOT_SCHEMA_VERSION),
  site: siteSnapshotSiteSchema,
  theme: siteSnapshotThemeSchema,
  pages: z.array(siteSnapshotPageSchema),
  media: z.array(mediaDescriptorSchema),
});

/**
 * v0.8 — adds `branding`, the resolved (`DEFAULT_SITE_BRANDING` + Site's
 * own overrides) `SiteBrandingV1`, frozen the same way `theme.tokens`
 * already is — see docs/adr/0021-site-theme-branding-design-system.md.
 * Everything else is byte-for-byte the v2 shape.
 */
export const siteSnapshotV3Schema = z.object({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  site: siteSnapshotSiteSchema,
  theme: siteSnapshotThemeSchema,
  branding: siteBrandingV1Schema,
  pages: z.array(siteSnapshotPageSchema),
  media: z.array(mediaDescriptorSchema),
});

export interface SiteSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  site: z.infer<typeof siteSnapshotSiteSchema>;
  theme: z.infer<typeof siteSnapshotThemeSchema>;
  /** Always present after normalization — a pre-v0.8 Revision is upgraded to {@link DEFAULT_SITE_BRANDING} at read time (see `parseSiteSnapshot`), never left absent. */
  branding: SiteBrandingV1;
  pages: SiteSnapshotPage[];
  /** `undefined` only for a normalized legacy (pre-v0.5) Revision — see the field comment on {@link siteSnapshotV3Schema}. */
  media?: MediaDescriptor[];
}

// --- Legacy (v0.4) compatibility -----------------------------------------
//
// A v0.4 Revision's stored `snapshot` has no `schemaVersion` field at all
// (it didn't exist yet) and its `site.navigation` is whatever raw,
// never-validated JSON happened to be in `sites.navigation` at publish
// time — in practice always `[]`, the column's own default, since no write
// path for it existed before v0.5 (see `packages/content/src/navigation.ts`'s
// `parseDraftNavigation` doc comment). This schema validates the *rest* of
// a legacy document strictly (nothing here should ever have been able to
// hold anything else) while accepting `navigation` as opaque.
const legacySiteSnapshotSchema = z.object({
  schemaVersion: z.undefined().optional(),
  site: z.object({
    name: z.string(),
    publicName: z.string().nullable(),
    timezone: z.string(),
    defaultLocale: z.string(),
    enabledLocales: z.array(z.string()),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    navigation: z.unknown(),
    features: z.record(z.string(), z.unknown()),
  }),
  theme: siteSnapshotThemeSchema,
  pages: z.array(siteSnapshotPageSchema),
});

/**
 * Normalizes an already-structurally-valid legacy (v0.4) snapshot into the
 * current runtime {@link SiteSnapshot} shape: `schemaVersion: 2` is a lie
 * (this document was never actually re-frozen), so it's tagged with the
 * legacy marker by simply omitting `media` — see the field's own comment.
 * `navigation` normalizes to {@link EMPTY_RESOLVED_NAVIGATION}: a v0.4
 * Revision's raw `navigation` value was never validated against any
 * schema and never had pageId targets resolved against *that Revision's*
 * Pages, so there is no principled way to reconstruct a
 * {@link ResolvedNavigation} from it — rendering "no navigation" for an
 * old Revision is not a data loss (nothing in v0.4 ever rendered
 * `site.navigation` either — see docs/PUBLISHING.md).
 */
function normalizeLegacySnapshot(legacy: z.infer<typeof legacySiteSnapshotSchema>): SiteSnapshot {
  // `media` is deliberately omitted, not set to `undefined` — under this
  // project's `exactOptionalPropertyTypes`, those are different things,
  // and "the key is absent" is the one that matches every other optional
  // field's convention across this codebase.
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    site: { ...legacy.site, navigation: EMPTY_RESOLVED_NAVIGATION },
    theme: legacy.theme,
    // v0.8 — a legacy (pre-v0.5) Revision predates `sites.branding` too;
    // the same "upgrade to the current default, never a data loss" posture
    // as `normalizeV2Snapshot` below, just one version further back.
    branding: DEFAULT_SITE_BRANDING,
    pages: legacy.pages,
  };
}

/**
 * v0.8 — upgrades an already-structurally-valid v2 (pre-branding)
 * Revision to the current runtime shape by adding
 * {@link DEFAULT_SITE_BRANDING}: this is the section 12/backward-
 * compatibility guarantee applied to an already-*published* Revision, not
 * just a fresh Draft — a Site published under v0.7.1 or earlier had no
 * concept of branding at all, so its frozen appearance now includes the
 * one official default rather than an absent/undefined field the renderer
 * would otherwise have to special-case.
 */
function normalizeV2Snapshot(v2: z.infer<typeof siteSnapshotV2Schema>): SiteSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    site: v2.site,
    theme: v2.theme,
    branding: DEFAULT_SITE_BRANDING,
    pages: v2.pages,
    media: v2.media,
  };
}

export class InvalidSnapshotError extends Error {
  constructor(reason: string) {
    super(`Revision snapshot is malformed: ${reason}`);
    this.name = "InvalidSnapshotError";
  }
}

export class UnknownSnapshotVersionError extends Error {
  constructor(public readonly schemaVersion: unknown) {
    super(`Revision snapshot has an unknown schemaVersion: ${JSON.stringify(schemaVersion)}`);
    this.name = "UnknownSnapshotVersionError";
  }
}

/**
 * The one trust boundary every stored `site_revisions.snapshot` JSONB
 * value must pass through before any caller treats it as a
 * {@link SiteSnapshot} (section 7 of the v0.5 brief — replaces the
 * previous `revision.snapshot as SiteSnapshot` casts in
 * `published-revision.ts`/`draft-service.ts`). Fails closed and
 * deterministically on anything it doesn't recognize — a corrupted
 * document or a schemaVersion from some future format throws, it never
 * falls back to the Draft and never returns a partially-trusted object.
 */
export function parseSiteSnapshot(raw: unknown): SiteSnapshot {
  if (raw === null || typeof raw !== "object") {
    throw new InvalidSnapshotError("not a JSON object");
  }
  const schemaVersion = (raw as { schemaVersion?: unknown }).schemaVersion;

  if (schemaVersion === undefined) {
    const legacy = legacySiteSnapshotSchema.safeParse(raw);
    if (!legacy.success) {
      throw new InvalidSnapshotError(
        `does not match the legacy (v0.4) format either: ${legacy.error.issues[0]?.message ?? "unknown error"}`,
      );
    }
    return normalizeLegacySnapshot(legacy.data);
  }

  if (schemaVersion === PREVIOUS_SNAPSHOT_SCHEMA_VERSION) {
    const parsedV2 = siteSnapshotV2Schema.safeParse(raw);
    if (!parsedV2.success) {
      throw new InvalidSnapshotError(parsedV2.error.issues[0]?.message ?? "unknown error");
    }
    return normalizeV2Snapshot(parsedV2.data);
  }

  if (schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new UnknownSnapshotVersionError(schemaVersion);
  }

  const parsed = siteSnapshotV3Schema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidSnapshotError(parsed.error.issues[0]?.message ?? "unknown error");
  }
  return parsed.data;
}
