import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgRole,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

// ---------------------------------------------------------------------------
// Roles
//
// Declared here purely so policies below can reference them by name. They
// are NOT managed by drizzle-kit (`.existing()`): passwords, LOGIN, and
// column-level GRANTs don't belong in a schema migration, and drizzle-kit
// would otherwise try to (re)create them on every `generate`. The roles
// themselves are created idempotently by
// packages/database/src/scripts/setup-roles.ts. See docs/SECURITY.md.
// ---------------------------------------------------------------------------
export const appRole = pgRole("provence360_app").existing();
export const resolverRole = pgRole("provence360_resolver").existing();
// Fourth role (v0.2): the narrow, pre-tenant-context path for
// authentication and authorization *lookups* — session validation,
// membership checks, the tenant switcher. Structurally the same shape as
// `resolverRole` (a request has no tenant yet, so it can't go through
// withTenantContext) but for a completely disjoint set of tables/columns:
// this role can never see site/domain content, and the resolver role can
// never see a password hash or a session. See docs/AUTHENTICATION.md.
export const authRole = pgRole("provence360_auth").existing();

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// `current_setting('app.tenant_id', true)` returns NULL when the GUC has
// never been touched on this connection — but on a pooled connection where
// some *earlier* transaction did `set_config('app.tenant_id', ..., true)`
// (see packages/tenant), Postgres remembers "app.tenant_id" as a known
// custom parameter for the rest of the session and its post-COMMIT reset
// value is an empty string, not NULL. A bare `::uuid` cast on '' raises a
// hard "invalid input syntax" error instead of evaluating to NULL/false.
// `nullif(..., '')` folds that empty string back to NULL first, so an
// absent tenant context reliably denies every row instead of sometimes
// erroring depending on connection reuse history. See
// packages/tenant/src/with-tenant-context.test.ts's "fails closed" test.
const currentTenantId = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

/** RLS predicate shared by every directly tenant-scoped table. */
const tenantMatch = sql`tenant_id = ${currentTenantId}`;

// ---------------------------------------------------------------------------
// users — a global identity, deliberately NOT tenant-scoped: one person can
// hold a Membership (and therefore a role) in any number of tenants, the
// same way a GitHub account exists independently of the orgs it belongs to.
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name"),
    // Nullable: an account with no password yet (future OAuth/passkey-only
    // users — see docs/adr/0006-authentication-strategy.md). Never selected
    // by `provence360_app` — see the column-restricted GRANT in
    // packages/database/src/admin/setup-roles.ts and the migration in
    // packages/database/migrations/0003_auth_role_grants.sql. An API
    // response, a log line, or an AuditLog row that contains this value is
    // a bug, not a feature.
    passwordHash: text("password_hash"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_uidx").on(t.email),
    // No tenant_id column exists on this table, so isolation is expressed as
    // an EXISTS check instead of a flat equality: a user row is visible only
    // if the current tenant context has a membership with that user. Still
    // fail-closed — no membership row, no visibility, no exceptions.
    pgPolicy("tenant_visible_users", {
      for: "select",
      to: appRole,
      using: sql`exists (
        select 1 from memberships m
        where m.user_id = users.id
          and m.tenant_id = ${currentTenantId}
      )`,
    }),
    // Pre-tenant-context lookups only: "find the user with this email" for
    // login, "load this session's user" for session validation. Column
    // grants (not this policy) are what keep this role from ever reading
    // password_hash of a row it has no business touching — this policy just
    // says "any row, if the columns you asked for are ones you're granted."
    pgPolicy("auth_lookup_users", {
      for: "select",
      to: authRole,
      using: sql`true`,
    }),
    // Password changes only (see packages/auth/src/password.ts). Column
    // grants restrict this to password_hash/updated_at — this role can
    // never change a user's email or name.
    pgPolicy("auth_update_users", {
      for: "update",
      to: authRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// tenants — the security/ownership boundary itself.
// ---------------------------------------------------------------------------
export const tenantStatusValues = ["active", "suspended"] as const;
export type TenantStatus = (typeof tenantStatusValues)[number];

export const tenants = pgTable(
  "tenants",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: tenantStatusValues }).notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("tenants_slug_uidx").on(t.slug),
    pgPolicy("tenant_isolation_tenants", {
      for: "all",
      to: appRole,
      using: sql`id = ${currentTenantId}`,
      withCheck: sql`id = ${currentTenantId}`,
    }),
    // Tenant switcher (list the tenants a user belongs to, by name) and
    // membership-check target validation (is this tenant even active?) both
    // run before a tenant context exists. Column grants restrict this to
    // display-safe fields (id, slug, name, status) — see setup-roles.ts.
    pgPolicy("auth_read_tenants", {
      for: "select",
      to: authRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// memberships — join table between users and tenants; the seam where roles
// will attach in a later phase. `role` is deliberately a small closed set
// for now (see ROADMAP for finer-grained permissions).
// ---------------------------------------------------------------------------
export const membershipRoleValues = ["owner", "admin", "member"] as const;
export type MembershipRole = (typeof membershipRoleValues)[number];

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: membershipRoleValues }).notNull().default("member"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_uidx").on(t.tenantId, t.userId),
    index("memberships_tenant_id_idx").on(t.tenantId),
    pgPolicy("tenant_isolation_memberships", {
      for: "all",
      to: appRole,
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
    // The authorization check itself: "does this user have a membership in
    // this tenant, and with what role?" — necessarily runs *before*
    // withTenantContext can open, since its result is what decides whether
    // to open it at all. Read-only: this role never creates, changes, or
    // removes a membership — that stays exclusively a tenant-scoped
    // operation via provence360_app (packages/domains-equivalent
    // repository, permission-checked).
    pgPolicy("auth_read_memberships", {
      for: "select",
      to: authRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// themes — a PLATFORM-level catalog (v0.3), deliberately not tenant-scoped:
// a design system a tenant *picks* and *narrowly overrides* per site
// (`sites.themeId`/`sites.themeOverrides` below), never one it authors
// wholesale — see docs/THEMES.md and docs/adr/0011-theme-token-model.md.
// Governed the same way `amenities` is: readable by every tenant, writable
// only by the admin/owner role (migrations/seed) in v0.3 — there is no
// tenant-facing "create a theme" capability yet, on purpose (see section 21
// of the brief: no arbitrary CSS, no ungoverned per-tenant forks).
// ---------------------------------------------------------------------------
export const themeStatusValues = ["active", "deprecated"] as const;
export type ThemeStatus = (typeof themeStatusValues)[number];

export const themes = pgTable(
  "themes",
  {
    id: id(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    // Semantic design tokens (color.*, font.*, radius.*, ...) — validated
    // against packages/themes' Zod schema on every write, never trusted as
    // opaque JSON. See docs/THEMES.md.
    tokens: jsonb("tokens").notNull(),
    status: text("status", { enum: themeStatusValues }).notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("themes_key_uidx").on(t.key),
    // Not tenant data — every tenant may read the shared catalog. No
    // INSERT/UPDATE/DELETE policy exists for provence360_app at all, so
    // (combined with no GRANT for those commands either — belt and
    // braces) a tenant-scoped request can never mutate the catalog.
    pgPolicy("read_themes", {
      for: "select",
      to: appRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// amenities — a PLATFORM-level, curated catalog (v0.3), the same shape as
// `themes` and for the same reason: an ungoverned per-tenant free-text
// amenities list would be unqueryable and untranslatable at scale ("wifi"
// vs "WiFi" vs "internet" vs "wi-fi" as three different tenants' strings).
// See docs/adr/0012-media-asset-and-amenity-catalog.md.
// ---------------------------------------------------------------------------
export const amenityCategoryValues = [
  "connectivity",
  "wellness",
  "outdoor",
  "comfort",
  "safety",
  "accessibility",
  "other",
] as const;
export type AmenityCategory = (typeof amenityCategoryValues)[number];

export const amenityStatusValues = ["active", "deprecated"] as const;
export type AmenityStatus = (typeof amenityStatusValues)[number];

export const amenities = pgTable(
  "amenities",
  {
    id: id(),
    key: text("key").notNull(),
    category: text("category", { enum: amenityCategoryValues }).notNull(),
    label: text("label").notNull(),
    description: text("description"),
    iconKey: text("icon_key"),
    status: text("status", { enum: amenityStatusValues }).notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("amenities_key_uidx").on(t.key),
    pgPolicy("read_amenities", {
      for: "select",
      to: appRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// sites — a public site owned by exactly one tenant. A tenant may own
// several. Draft/Release/Theme/Settings etc. are intentionally not modeled
// yet (see ROADMAP) — Foundation v0.1 only needs enough to prove
// Host -> Site -> Tenant resolution end to end.
// ---------------------------------------------------------------------------
export const siteStatusValues = ["draft", "active", "suspended"] as const;
export type SiteStatus = (typeof siteStatusValues)[number];

export const sites = pgTable(
  "sites",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    // The tenant-admin-facing display label — kept as `name` (not renamed
    // to `internalName`) to avoid breaking every v0.1/v0.2 caller and test
    // that already reads/writes this column; it always meant "internal
    // name," it just didn't have a public counterpart yet. `publicName`
    // (v0.3) is what actually renders on the public site; falls back to
    // `name` when unset so existing seeded/tested sites keep working
    // unchanged.
    name: text("name").notNull(),
    publicName: text("public_name"),
    status: text("status", { enum: siteStatusValues }).notNull().default("draft"),
    // IANA time zone identifier (e.g. "Europe/Paris"). Validated as a real
    // zone by packages/validation's Zod schema at every write — Postgres
    // has no native "is this a real IANA zone" constraint, so this column
    // is deliberately plain `text`, not an enum (the IANA database changes
    // over time; baking it into a Postgres enum would need a migration
    // every time it does).
    timezone: text("timezone").notNull().default("Europe/Paris"),
    // BCP 47-ish locale tags ("fr", "en"). `defaultLocale` must always be a
    // member of `enabledLocales` — enforced by Zod at the application
    // boundary (packages/validation), not by Postgres: JSONB has no
    // "array contains this scalar column's value" constraint. See
    // docs/LOCALIZATION.md.
    defaultLocale: text("default_locale").notNull().default("fr"),
    enabledLocales: jsonb("enabled_locales").notNull().default(["fr"]),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    // Which base Theme this site resolves against, and the (validated,
    // narrow) per-site token overrides layered on top of it — see
    // packages/themes and docs/THEMES.md. Nullable: a brand-new site has
    // no theme chosen yet and renders with the renderer's hard-coded
    // fallback tokens rather than failing to render at all.
    themeId: uuid("theme_id").references(() => themes.id, { onDelete: "set null" }),
    themeOverrides: jsonb("theme_overrides").notNull().default({}),
    // Ordered nav items ({ label, href }-shaped, validated by
    // packages/content's NavigationSchema) and a flat feature-flag object
    // (validated against a closed key catalog) — both genuinely
    // polymorphic per-site configuration, neither one has invariants a
    // relational column could express better. See section 4/21 of the
    // brief and docs/SITE_DOMAIN.md for why these are JSONB while address
    // fields etc. below are not.
    navigation: jsonb("navigation").notNull().default([]),
    features: jsonb("features").notNull().default({}),
    // v0.4 — the single source of truth for "what's currently live on the
    // public site" (see docs/PUBLISHING.md and ADR 0016). Nullable: a
    // brand-new site has never been published.
    //
    // Declared here as a plain column, not `.references(...)` — `site_revisions`
    // is declared further down this file, and Drizzle's table-config
    // `foreignKey()` helper needs its target's columns to already be
    // initialized bindings at the point it runs, which a forward reference
    // from here can't satisfy (temporal dead zone). The REAL constraint
    // still exists at the database level: migration 0010
    // (`0010_sites_published_revision_composite_fk.sql`) hand-adds
    // `FOREIGN KEY (tenant_id, id, published_revision_id) REFERENCES
    // site_revisions (tenant_id, site_id, id) ON DELETE RESTRICT` via raw
    // SQL, since Drizzle's schema DSL can't express this composite FK
    // (same forward-reference limitation) — see ADR 0016's "Decision 1"
    // update. That constraint is what makes "this Site's published
    // Revision belongs to a different tenant" or "...to a different Site
    // in the same tenant" a `23503` Postgres error, not merely something
    // application code and RLS happen to also prevent. This column and
    // that migration must be read together; this comment is not a
    // substitute for reading migration 0010.
    publishedRevisionId: uuid("published_revision_id"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("sites_tenant_slug_uidx").on(t.tenantId, t.slug),
    index("sites_tenant_id_idx").on(t.tenantId),
    // Lets child tables (properties, pages) declare a composite foreign
    // key against (tenant_id, id) instead of just (id) — see
    // docs/adr/0010-property-unit-ownership.md. This is what makes a
    // cross-tenant reference (a Property whose tenant_id doesn't match its
    // parent Site's tenant_id) a constraint violation Postgres itself
    // rejects, not just something RLS happens to also hide.
    uniqueIndex("sites_tenant_id_id_uidx").on(t.tenantId, t.id),
    pgPolicy("tenant_isolation_sites", {
      for: "all",
      to: appRole,
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
    // Narrow, additional, read-only exception for the hostname resolver
    // (see packages/domains/src/resolver.ts): it runs *before* a tenant is
    // known, so it cannot go through withTenantContext. Column-level GRANTs
    // in setup-roles.ts further restrict this role to routing-safe columns
    // only (id, tenant_id, status) — it can never see site content.
    pgPolicy("resolver_read_sites", {
      for: "select",
      to: resolverRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// domains — a hostname bound to a site. tenant_id is denormalized from the
// owning site purely so every policy here stays a flat, indexable equality
// (no cross-table join inside the policy). Repositories are responsible for
// keeping domains.tenant_id equal to sites.tenant_id at write time (see
// packages/domains/src/domain-repository.ts).
// ---------------------------------------------------------------------------
export const domainStatusValues = ["pending", "active", "disabled"] as const;
export type DomainStatus = (typeof domainStatusValues)[number];

export const domains = pgTable(
  "domains",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    status: text("status", { enum: domainStatusValues }).notNull().default("pending"),
    ...timestamps,
  },
  (t) => [
    // Global uniqueness while active: two tenants can never simultaneously
    // claim the same live hostname. Disabled/pending rows may collide (e.g.
    // a released domain being re-claimed) — that's intentional.
    uniqueIndex("domains_hostname_active_uidx")
      .on(t.hostname)
      .where(sql`status = 'active'`),
    index("domains_site_id_idx").on(t.siteId),
    index("domains_tenant_id_idx").on(t.tenantId),
    pgPolicy("tenant_isolation_domains", {
      for: "all",
      to: appRole,
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
    pgPolicy("resolver_read_domains", {
      for: "select",
      to: resolverRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// media_assets — a reference to a stored file (image/video/document), never
// the file itself and never an arbitrary URL. `storageKey` is an opaque
// pointer into whatever object storage a deployment uses; the actual
// upload/CDN/transform pipeline is out of scope for v0.3 (see
// docs/adr/0012-media-asset-and-amenity-catalog.md and docs/ROADMAP.md) —
// this table exists so content can hold a stable, typed *reference*
// instead of a bare string scattered through JSONB. Deliberately no
// `updatedAt`: once created, a media asset's own metadata doesn't change —
// a new version is a new row, not an edit (same reasoning as an immutable
// audit log entry, see docs/SITE_DOMAIN.md#future-release-compatibility).
// ---------------------------------------------------------------------------
export const mediaKindValues = ["image", "video", "document"] as const;
export type MediaKind = (typeof mediaKindValues)[number];

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: mediaKindValues }).notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("media_assets_tenant_storage_key_uidx").on(t.tenantId, t.storageKey),
    uniqueIndex("media_assets_tenant_id_id_uidx").on(t.tenantId, t.id),
    index("media_assets_tenant_id_idx").on(t.tenantId),
    pgPolicy("tenant_isolation_media_assets", {
      for: "all",
      to: appRole,
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// properties — a tourist property/place (the RENTAL domain's business
// data, deliberately separate from any Site's presentation — see section 2
// of the brief and docs/adr/0010-property-unit-ownership.md). A Property
// belongs to exactly one Site in v0.3 (the simplest correct model, not a
// permanent constraint — see the ADR for the future many-to-many path) and
// always, redundantly, to that Site's own tenant: `(tenant_id, site_id)`
// is a composite foreign key against `sites(tenant_id, id)`, so a Property
// whose tenant_id doesn't match its Site's tenant_id is a constraint
// Postgres itself refuses, not merely something RLS happens to also hide.
// ---------------------------------------------------------------------------
export const propertyTypeValues = [
  "villa",
  "house",
  "gite",
  "domaine",
  "guest_house",
  "apartment",
  "other",
] as const;
export type PropertyType = (typeof propertyTypeValues)[number];

export const propertyStatusValues = ["draft", "active", "archived"] as const;
export type PropertyStatus = (typeof propertyStatusValues)[number];

// A tri-state, not a boolean: "not specified by the owner" (NULL) must stay
// distinguishable from an explicit "not allowed" — collapsing the two would
// silently turn "the owner hasn't said" into "forbidden," which is a
// fabricated fact this codebase's "unknown ≠ zero/false" philosophy (see
// `units.maxGuests`/`bedrooms` above) already rejects for numeric fields.
// `on_request` is a real third state (common in short-term rental listings:
// "pets on request"), not just UI sugar over allowed/not_allowed.
export const rentalPolicyValues = ["allowed", "not_allowed", "on_request"] as const;
export type RentalPolicy = (typeof rentalPolicyValues)[number];

// v0.6 guest-facing location-privacy disclosure (section 8/13 of the
// brief). Defaults to "exact" specifically so existing seeded Properties'
// already-rendered address keeps rendering unchanged after this migration
// — a silent behavior change on upgrade would be worse than requiring an
// owner to opt into hiding their address. "approximate" exposes
// city/region/country only; "hidden" exposes no location fields at all.
// See `packages/rentals/src/guest-view.ts` for where this is enforced —
// deliberately server-side, not merely UI-hidden, so a renderer bug can
// never leak a private address (docs/adr/0018-rental-domain-guest-experience.md).
export const locationDisclosureValues = ["exact", "approximate", "hidden"] as const;
export type LocationDisclosure = (typeof locationDisclosureValues)[number];

export const properties = pgTable(
  "properties",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    internalName: text("internal_name").notNull(),
    publicName: text("public_name").notNull(),
    slug: text("slug").notNull(),
    // Simple plain-text description for v0.3 — structured/rich editorial
    // copy belongs in the Content Graph (a Page's PropertySummary block),
    // not duplicated here. See section 15 of the brief.
    description: text("description"),
    propertyType: text("property_type", { enum: propertyTypeValues }).notNull(),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    addressCity: text("address_city"),
    addressPostalCode: text("address_postal_code"),
    addressRegion: text("address_region"),
    addressCountry: text("address_country"),
    // Nullable, never a 0/0 sentinel — "no coordinates set yet" must be
    // distinguishable from "coordinates are (0, 0)" (a real place in the
    // Gulf of Guinea). See docs/SITE_DOMAIN.md.
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    // Nullable: falls back to the owning Site's timezone when unset — most
    // properties share their site's timezone; only a multi-region tenant
    // needs to override it per property.
    timezone: text("timezone"),
    status: text("status", { enum: propertyStatusValues }).notNull().default("draft"),
    // v0.6 Guest Experience fields (section 6/8 of the brief). Plain
    // Postgres `time` columns (not `text`), so "14:00" is validated and
    // compared by Postgres itself, locale-independently — never a raw
    // string a caller could hand in as "2pm" or "14h00". Nullable: "not
    // specified" is a real, distinct state from any particular time (same
    // reasoning as every other nullable capacity column on `units`).
    checkInTime: time("check_in_time"),
    checkOutTime: time("check_out_time"),
    // Deliberately NOT constrained to `quietHoursStart < quietHoursEnd` — a
    // quiet window legitimately wraps midnight (e.g. 22:00 -> 08:00), which
    // is the common case, not an edge case, so an ordering CHECK would
    // reject the very values this field exists to hold. Only "both set or
    // both null" is enforced (see `properties_quiet_hours_pair_ck` below).
    quietHoursStart: time("quiet_hours_start"),
    quietHoursEnd: time("quiet_hours_end"),
    smokingPolicy: text("smoking_policy", { enum: rentalPolicyValues }),
    petsPolicy: text("pets_policy", { enum: rentalPolicyValues }),
    eventsPolicy: text("events_policy", { enum: rentalPolicyValues }),
    locationDisclosure: text("location_disclosure", { enum: locationDisclosureValues })
      .notNull()
      .default("exact"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("properties_site_slug_uidx").on(t.siteId, t.slug),
    uniqueIndex("properties_tenant_id_id_uidx").on(t.tenantId, t.id),
    index("properties_tenant_id_idx").on(t.tenantId),
    index("properties_site_id_idx").on(t.siteId),
    foreignKey({
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: "properties_tenant_site_fk",
    }).onDelete("cascade"),
    // Same both-null-or-both-set shape as `units_size_requires_unit_ck`.
    check(
      "properties_quiet_hours_pair_ck",
      sql`(${t.quietHoursStart} is null and ${t.quietHoursEnd} is null) or (${t.quietHoursStart} is not null and ${t.quietHoursEnd} is not null)`,
    ),
    pgPolicy("tenant_isolation_properties", {
      for: "all",
      to: appRole,
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// units — an individually describable (and, later, bookable) space within a
// Property. "Villa du Ventoux" (one Unit == the whole villa) and "Domaine
// des Oliviers" (three Units: main villa, studio, independent room) are
// both ordinary Properties under this model — see section 5 of the brief.
// Same composite-FK ownership pattern as Property -> Site.
// ---------------------------------------------------------------------------
export const unitStatusValues = ["draft", "active", "archived", "not_bookable_separately"] as const;
export type UnitStatus = (typeof unitStatusValues)[number];

export const unitSizeUnitValues = ["sqm", "sqft"] as const;
export type UnitSizeUnit = (typeof unitSizeUnitValues)[number];

export const units = pgTable(
  "units",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull(),
    internalName: text("internal_name").notNull(),
    publicName: text("public_name").notNull(),
    slug: text("slug").notNull(),
    status: text("status", { enum: unitStatusValues }).notNull().default("draft"),
    // All capacity/room counts are nullable — "unknown" must never be
    // conflated with "zero" (a studio has 0 separate bedrooms and is not
    // the same as "bedroom count unknown"). `bathrooms` is `numeric(3,1)`
    // specifically to represent a half-bathroom (1.5) without inventing a
    // separate "half baths" column. See docs/SITE_DOMAIN.md.
    maxGuests: integer("max_guests"),
    bedrooms: integer("bedrooms"),
    beds: integer("beds"),
    bathrooms: numeric("bathrooms", { precision: 3, scale: 1 }),
    size: numeric("size", { precision: 8, scale: 2 }),
    sizeUnit: text("size_unit", { enum: unitSizeUnitValues }),
    description: text("description"),
    // Render order within a UnitGrid block — an explicit column (not
    // array-position-in-a-JSON-document) because Units are relational rows
    // queried directly, not embedded in a block's own JSON.
    ordering: integer("ordering").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("units_property_slug_uidx").on(t.propertyId, t.slug),
    uniqueIndex("units_tenant_id_id_uidx").on(t.tenantId, t.id),
    // v0.7: lets a child table declare a composite FK against
    // `(tenant_id, property_id, id)` — not just `(tenant_id, id)` — so
    // Postgres itself can enforce "this Unit belongs to this Property,"
    // not only "this Unit belongs to this tenant." See `virtual_tours`
    // below and docs/adr/0019-virtual-tour-immersive-kernel.md. Added here
    // (a new index on an existing table) rather than modifying migration
    // 0000/0005's original DDL — append-only, same pattern as
    // `sites_tenant_id_id_uidx` (migration 0000) enabling later composite
    // FKs from `properties`/`pages`.
    uniqueIndex("units_tenant_property_id_uidx").on(t.tenantId, t.propertyId, t.id),
    index("units_tenant_id_idx").on(t.tenantId),
    index("units_property_id_idx").on(t.propertyId),
    foreignKey({
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
      name: "units_tenant_property_fk",
    }).onDelete("cascade"),
    // sizeUnit is required exactly when size is present — Postgres CAN
    // express this invariant (unlike the JSONB ones elsewhere in this
    // schema), so it does, as a real CHECK rather than only an
    // application-layer Zod rule.
    check(
      "units_size_requires_unit_ck",
      sql`(${t.size} is null and ${t.sizeUnit} is null) or (${t.size} is not null and ${t.sizeUnit} is not null)`,
    ),
    pgPolicy("tenant_isolation_units", {
      for: "all",
      to: appRole,
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// unit_sleeping_arrangements — v0.6: a Unit's sleeping spaces as individual,
// orderable rows ("Bedroom 1: 1 king bed", "Living room: 1 sofa bed"),
// replacing the crude `units.beds` aggregate for any Unit detailed enough
// to have them. Relational, not JSONB (section 9/10 of the brief): each row
// has a real per-row identity for individual create/update/delete, a stable
// `ordering` column the same way `units.ordering` already works, and full
// tenant isolation via RLS — none of which JSONB can express as cleanly.
//
// Aggregates-vs-detail coherence (section 10): `units.beds` remains the
// fallback total when no detail rows exist for a Unit; whenever detail rows
// do exist, the *sum of their quantities* is the effective bed count for
// display, and `units.beds` is treated as stale/advisory for that Unit. See
// `packages/rentals/src/guest-view.ts`'s `effectiveBedCount` and
// docs/adr/0018-rental-domain-guest-experience.md — this is a deliberate
// choice to make "beds: 3" vs. "detail rows summing to 5" impossible to
// display simultaneously, rather than reconciling or validating the two
// against each other at write time.
// ---------------------------------------------------------------------------
export const bedTypeValues = [
  "single",
  "double",
  "queen",
  "king",
  "bunk",
  "sofa_bed",
  "floor_mattress",
  "crib",
  "other",
] as const;
export type BedType = (typeof bedTypeValues)[number];

export const unitSleepingArrangements = pgTable(
  "unit_sleeping_arrangements",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    // e.g. "Bedroom 1", "Living room" — nullable: a small Unit may just
    // have "1 queen bed" with no meaningful room subdivision to name.
    roomLabel: text("room_label"),
    bedType: text("bed_type", { enum: bedTypeValues }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    ordering: integer("ordering").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("unit_sleeping_arrangements_tenant_id_id_uidx").on(t.tenantId, t.id),
    index("unit_sleeping_arrangements_tenant_id_idx").on(t.tenantId),
    index("unit_sleeping_arrangements_unit_id_idx").on(t.unitId),
    foreignKey({
      columns: [t.tenantId, t.unitId],
      foreignColumns: [units.tenantId, units.id],
      name: "unit_sleeping_arrangements_tenant_unit_fk",
    }).onDelete("cascade"),
    check("unit_sleeping_arrangements_quantity_positive_ck", sql`${t.quantity} > 0`),
    pgPolicy("tenant_isolation_unit_sleeping_arrangements", {
      for: "all",
      to: appRole,
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// unit_amenities — join table asserting "this Unit has this (catalog)
// Amenity." `amenity_id` references the global, non-tenant-scoped
// `amenities` catalog directly (no tenant check needed — the catalog isn't
// tenant data); `unit_id` uses the same composite-FK ownership pattern as
// everything else so a tenant can never attach an amenity to a Unit it
// doesn't own.
// ---------------------------------------------------------------------------
export const unitAmenities = pgTable(
  "unit_amenities",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    amenityId: uuid("amenity_id")
      .notNull()
      .references(() => amenities.id, { onDelete: "restrict" }),
    // Small, optional, amenity-specific metadata (e.g. `{ heated: true }`
    // for a pool) — deliberately not a place to smuggle in unrelated data;
    // see docs/adr/0012-media-asset-and-amenity-catalog.md for the "don't
    // over-engineer this yet" reasoning.
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("unit_amenities_unit_amenity_uidx").on(t.unitId, t.amenityId),
    index("unit_amenities_tenant_id_idx").on(t.tenantId),
    index("unit_amenities_unit_id_idx").on(t.unitId),
    foreignKey({
      columns: [t.tenantId, t.unitId],
      foreignColumns: [units.tenantId, units.id],
      name: "unit_amenities_tenant_unit_fk",
    }).onDelete("cascade"),
    pgPolicy("tenant_isolation_unit_amenities", {
      for: "all",
      to: appRole,
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// property_amenities — v0.6: the same join shape as `unit_amenities`, one
// level up (section 11 of the brief: Amenities were Unit-only; a Property
// itself can have its own amenities — e.g. "shared pool," "on-site
// parking" — distinct from any one Unit's amenities). Deliberately a
// separate table, not a nullable `unitId`-or-`propertyId` column on
// `unit_amenities`: that would turn one FK/RLS-clean join table into two
// mutually-exclusive-but-not-enforced shapes sharing one table, which is a
// worse invariant to maintain than a second, identically-shaped table.
// Reuses the same global Amenity catalog — no separate "property amenity
// catalog" was created (section 11 explicitly warns against this).
// ---------------------------------------------------------------------------
export const propertyAmenities = pgTable(
  "property_amenities",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull(),
    amenityId: uuid("amenity_id")
      .notNull()
      .references(() => amenities.id, { onDelete: "restrict" }),
    // Same minimal, validated shape as `unit_amenities.metadata` — see
    // `packages/rentals/src/validation.ts`'s `amenityMetadataSchema`.
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("property_amenities_property_amenity_uidx").on(t.propertyId, t.amenityId),
    index("property_amenities_tenant_id_idx").on(t.tenantId),
    index("property_amenities_property_id_idx").on(t.propertyId),
    foreignKey({
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
      name: "property_amenities_tenant_property_fk",
    }).onDelete("cascade"),
    pgPolicy("tenant_isolation_property_amenities", {
      for: "all",
      to: appRole,
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// virtual_tours — v0.7: a reference to an externally-hosted immersive tour
// (Matterport Showcase and, later, other providers), never the embed
// itself. Deliberately NOT a `MediaAsset` (see
// docs/adr/0019-virtual-tour-immersive-kernel.md): a tour has a provider,
// an external identity, a business lifecycle (draft/active/archived) of
// its own, and an embed policy — none of which fit MediaAsset's
// "reference to a stored file" shape.
//
// A VirtualTour always belongs to a Property; a Unit is optional (a
// whole-Property tour vs. a Unit-specific one — same "not every Property
// has meaningfully separate Units" shape as `units` itself, see
// docs/SITE_DOMAIN.md). When `unit_id` is set, the composite FK below
// forces it to be a Unit of *this same* Property and tenant — Postgres
// enforced, not merely a TypeScript-level check.
// ---------------------------------------------------------------------------
export const virtualTourProviderValues = ["matterport"] as const;
export type VirtualTourProvider = (typeof virtualTourProviderValues)[number];

// Same three-state shape as `properties`/`units`: `draft` while an owner is
// still setting it up, `active` once it's meant to be publicly embeddable,
// `archived` once retired — never deleted outright unless the tenant
// explicitly deletes the row (see `deleteVirtualTour`). Only `active` is
// ever publicly embeddable — see `isPublicVirtualTourStatus` in
// `packages/virtual-tours`.
export const virtualTourStatusValues = ["draft", "active", "archived"] as const;
export type VirtualTourStatus = (typeof virtualTourStatusValues)[number];

export const virtualTours = pgTable(
  "virtual_tours",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull(),
    unitId: uuid("unit_id"),
    provider: text("provider", { enum: virtualTourProviderValues }).notNull(),
    // The provider's own canonical, normalized identity for this tour
    // (e.g. a Matterport model SID) — never a raw pasted URL, never HTML.
    // See `packages/virtual-tours`' provider registry: the admin-facing
    // input (a share URL or a bare id) is parsed and normalized to this
    // value *before* it ever reaches this column.
    providerAssetId: text("provider_asset_id").notNull(),
    internalName: text("internal_name").notNull(),
    publicName: text("public_name").notNull(),
    status: text("status", { enum: virtualTourStatusValues }).notNull().default("draft"),
    // Render order when a Property/Unit has more than one tour — same
    // pattern as `units.ordering`/`unit_sleeping_arrangements.ordering`.
    ordering: integer("ordering").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("virtual_tours_tenant_id_id_uidx").on(t.tenantId, t.id),
    index("virtual_tours_tenant_id_idx").on(t.tenantId),
    index("virtual_tours_property_id_idx").on(t.propertyId),
    index("virtual_tours_unit_id_idx").on(t.unitId),
    foreignKey({
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
      name: "virtual_tours_tenant_property_fk",
    }).onDelete("cascade"),
    // The Unit-ownership guarantee (section 5 of the brief): under
    // Postgres's default MATCH SIMPLE, this composite FK is satisfied
    // (not checked at all) whenever `unit_id` is NULL — exactly the
    // "Property-level tour, no Unit" case. Whenever `unit_id` IS set, all
    // three columns are non-null and Postgres requires a matching
    // `units` row with that *same* `tenant_id` AND `property_id` AND
    // `id` — a Unit belonging to a different Property (even within the
    // same tenant) is rejected at INSERT/UPDATE time (`23503`), not
    // merely something application code happens to also check. See
    // `units_tenant_property_id_uidx` above.
    foreignKey({
      columns: [t.tenantId, t.propertyId, t.unitId],
      foreignColumns: [units.tenantId, units.propertyId, units.id],
      name: "virtual_tours_tenant_property_unit_fk",
    }).onDelete("cascade"),
    check("virtual_tours_ordering_nonneg_ck", sql`${t.ordering} >= 0`),
    check("virtual_tours_provider_asset_id_nonempty_ck", sql`length(${t.providerAssetId}) > 0`),
    // Deliberately NOT `unique(tenant_id, provider, provider_asset_id)`:
    // the same physical provider asset (e.g. a Matterport Space covering
    // a shared amenity area) may legitimately be worth referencing from
    // more than one VirtualTour row (a Property-level tour and a
    // Unit-level one pointing at the same underlying space, or a
    // duplicated draft being iterated on before archiving the original).
    // Nothing in the brief requires "one row per provider asset per
    // tenant," and adding that constraint speculatively would block a
    // legitimate re-use case for no stated benefit — see
    // docs/adr/0019-virtual-tour-immersive-kernel.md.
    pgPolicy("tenant_isolation_virtual_tours", {
      for: "all",
      to: appRole,
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// pages — the Content Graph's addressable unit: one URL, one ordered list
// of Block instances. `content` is a validated JSONB array (see
// packages/content and docs/adr/0013-page-content-storage.md for why a
// document over relational block rows), never trusted as opaque JSON by
// anything that reads it — every read re-validates through the Block
// Registry. Same composite-FK ownership pattern tying every Page to its
// Site's own tenant.
// ---------------------------------------------------------------------------
export const pageTypeValues = ["home", "standard", "property", "unit", "contact"] as const;
export type PageType = (typeof pageTypeValues)[number];

export const pageStatusValues = ["draft", "active", "archived"] as const;
export type PageStatus = (typeof pageStatusValues)[number];

export const pages = pgTable(
  "pages",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    slug: text("slug").notNull(),
    internalName: text("internal_name").notNull(),
    status: text("status", { enum: pageStatusValues }).notNull().default("draft"),
    pageType: text("page_type", { enum: pageTypeValues }).notNull().default("standard"),
    // { title?, description?, canonicalPath?, noIndex?, noFollow?,
    //   ogImageMediaId? } — validated by packages/content's SeoSchema. See
    // docs/SEO section of docs/RENDERING.md.
    seo: jsonb("seo").notNull().default({}),
    // Block instances: [{ id, type, version, props }, ...]. `id` is stable
    // per instance (see section 18 of the brief); `type`/`version` select
    // which registered schema `props` must satisfy — see
    // packages/content/src/block-registry.ts.
    content: jsonb("content").notNull().default([]),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("pages_site_slug_uidx").on(t.siteId, t.slug),
    // At most one HOME page per site — a real invariant, enforced by
    // Postgres, not just convention.
    uniqueIndex("pages_site_home_uidx")
      .on(t.siteId)
      .where(sql`page_type = 'home'`),
    index("pages_tenant_id_idx").on(t.tenantId),
    index("pages_site_id_idx").on(t.siteId),
    foreignKey({
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: "pages_tenant_site_fk",
    }).onDelete("cascade"),
    check("pages_content_is_array_ck", sql`jsonb_typeof(${t.content}) = 'array'`),
    pgPolicy("tenant_isolation_pages", {
      for: "all",
      to: appRole,
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// site_revisions — an immutable snapshot of everything a Site needs to
// render a specific, reproducible version of itself (v0.4, see
// docs/PUBLISHING.md and ADR 0016). `snapshot` holds the Pages' `content`
// (the only genuinely "authored, must-freeze" data per
// docs/SITE_DOMAIN.md#future-release-compatibility) plus the Site's own
// presentation fields and its fully *resolved* theme tokens at the moment
// the revision was created — never a live `themeId` reference, so a later
// re-theme of the Site can't retroactively change how an already-published
// Revision looked. Property/Unit/Amenity data is deliberately NOT
// snapshotted (same ADR): a PropertySummary/UnitGrid block still shows
// *today's* Property data even under an old Revision, exactly like a
// printed brochure with a phone number on it.
//
// Append-only by construction, the same pattern as `audit_logs` above: no
// UPDATE/DELETE policy exists for `provence360_app` at all, so those
// commands are denied by RLS's default-deny regardless of tenant_id — a
// Revision cannot be edited in place by a coding mistake, only ever
// created fresh.
// ---------------------------------------------------------------------------
export const siteRevisions = pgTable(
  "site_revisions",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    // Monotonically increasing per Site, starting at 1 — assigned inside
    // `createRevisionFromDraft` (packages/publishing) while holding a
    // `SELECT ... FOR UPDATE` lock on the Site row, so two concurrent
    // publishes on the same Site can never compute the same number. The
    // unique index below is the database-level backstop for that
    // invariant, not the primary mechanism.
    revisionNumber: integer("revision_number").notNull(),
    // { site: {...presentation fields}, theme: { themeId, tokens }, pages:
    // [{ slug, internalName, pageType, seo, content }, ...] } — see
    // packages/publishing/src/snapshot.ts for the exact shape. Deliberately
    // one JSONB document, not relational child rows: a Revision is read
    // whole or not at all, and a document is trivial to copy verbatim from
    // the live draft tables at publish time (same reasoning as
    // `pages.content` itself — see ADR 0013).
    snapshot: jsonb("snapshot").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("site_revisions_site_number_uidx").on(t.siteId, t.revisionNumber),
    uniqueIndex("site_revisions_tenant_id_id_uidx").on(t.tenantId, t.id),
    // The FK target for `sites.published_revision_id` (migration 0010) —
    // a 3-column UNIQUE constraint a composite foreign key can reference,
    // proving at the database level that a Site's published Revision
    // really belongs to that same Site (not just that same tenant).
    uniqueIndex("site_revisions_tenant_site_id_uidx").on(t.tenantId, t.siteId, t.id),
    index("site_revisions_tenant_id_idx").on(t.tenantId),
    // The public runtime's hot path: "the current published revision for
    // this site" is a single-row lookup by id (via sites.published_revision_id),
    // but the admin history view lists every revision for a site newest
    // first — this index serves that query.
    index("site_revisions_site_id_number_idx").on(t.siteId, t.revisionNumber),
    foreignKey({
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: "site_revisions_tenant_site_fk",
    }).onDelete("cascade"),
    check("site_revisions_number_positive_ck", sql`${t.revisionNumber} > 0`),
    pgPolicy("tenant_read_site_revisions", {
      for: "select",
      to: appRole,
      using: tenantMatch,
    }),
    pgPolicy("tenant_insert_site_revisions", {
      for: "insert",
      to: appRole,
      withCheck: tenantMatch,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// site_publications — an append-only history of "Revision X became the
// active one for Site Y" events (v0.4). Deliberately NOT the source of
// truth for "what's live right now" — that is exclusively
// `sites.published_revision_id` (see the comment on that column). Reading
// this table can never tell you the current state faster or more
// authoritatively than that one column; it exists purely so the admin can
// show "publication history" and so a rollback's provenance
// (`previous_revision_id`) is recorded somewhere, avoiding the two-sources-
// of-truth trap the v0.4 brief warns about.
// ---------------------------------------------------------------------------
export const publicationActionValues = ["publish", "rollback"] as const;
export type PublicationAction = (typeof publicationActionValues)[number];

export const sitePublications = pgTable(
  "site_publications",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    previousRevisionId: uuid("previous_revision_id"),
    action: text("action", { enum: publicationActionValues }).notNull(),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("site_publications_tenant_id_idx").on(t.tenantId),
    // The admin history view's query shape: "this site's publications,
    // newest first."
    index("site_publications_site_id_created_idx").on(t.siteId, t.createdAt),
    foreignKey({
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: "site_publications_tenant_site_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.revisionId],
      foreignColumns: [siteRevisions.tenantId, siteRevisions.id],
      name: "site_publications_tenant_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.previousRevisionId],
      foreignColumns: [siteRevisions.tenantId, siteRevisions.id],
      name: "site_publications_tenant_previous_revision_fk",
    }).onDelete("set null"),
    pgPolicy("tenant_read_site_publications", {
      for: "select",
      to: appRole,
      using: tenantMatch,
    }),
    pgPolicy("tenant_insert_site_publications", {
      for: "insert",
      to: appRole,
      withCheck: tenantMatch,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// audit_logs — append-only by construction: the app role gets SELECT and
// INSERT policies but no UPDATE/DELETE policy at all, so those commands are
// denied by RLS's default-deny regardless of tenant_id. An audit trail that
// can be edited by the same role it's auditing is not a trail.
//
// `tenant_id` is nullable (v0.2): identity-plane events — login success,
// login failure, logout — happen *before* any tenant is selected, so they
// have no tenant to attach to. They are written by `provence360_auth` with
// tenant_id = NULL, and are structurally invisible to `provence360_app`
// (`tenant_id = <current tenant>` is never true for a NULL row) — a tenant
// can never see platform-wide auth events, only its own tenant-scoped
// activity. Reading the NULL-tenant rows back is a platform-admin concern,
// deliberately out of scope for v0.2 — see docs/adr/0009-platform-admin-vs-tenant-owner.md.
// ---------------------------------------------------------------------------
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_tenant_id_idx").on(t.tenantId),
    index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt),
    pgPolicy("tenant_read_audit_logs", {
      for: "select",
      to: appRole,
      using: tenantMatch,
    }),
    pgPolicy("tenant_insert_audit_logs", {
      for: "insert",
      to: appRole,
      withCheck: tenantMatch,
    }),
    // provence360_auth may only ever write/read the platform-level
    // (tenant_id IS NULL) slice — structurally incapable of forging a
    // tenant-scoped audit row, and incapable of reading any tenant's trail.
    pgPolicy("auth_insert_audit_logs", {
      for: "insert",
      to: authRole,
      withCheck: sql`tenant_id is null`,
    }),
    pgPolicy("auth_read_audit_logs", {
      for: "select",
      to: authRole,
      using: sql`tenant_id is null`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// sessions — an opaque, revocable proof of identity, deliberately separate
// from `users`. `id` is the SHA-256 hex digest of the raw session token
// (see packages/auth/src/session.ts) — the raw token itself is never
// stored anywhere, only its hash, the same defense-in-depth reasoning as
// storing a password hash instead of the password. Owned entirely by
// `provence360_auth`; `provence360_app` (tenant-scoped code) has no grant
// on this table at all — a session is an identity-plane concept, not
// tenant data.
// ---------------------------------------------------------------------------
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    pgPolicy("auth_manage_sessions", {
      for: "all",
      to: authRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();
