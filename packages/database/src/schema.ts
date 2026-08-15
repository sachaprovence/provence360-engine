import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgPolicy,
  pgRole,
  pgTable,
  text,
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
    name: text("name").notNull(),
    status: text("status", { enum: siteStatusValues }).notNull().default("draft"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("sites_tenant_slug_uidx").on(t.tenantId, t.slug),
    index("sites_tenant_id_idx").on(t.tenantId),
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
// audit_logs — append-only by construction: the app role gets SELECT and
// INSERT policies but no UPDATE/DELETE policy at all, so those commands are
// denied by RLS's default-deny regardless of tenant_id. An audit trail that
// can be edited by the same role it's auditing is not a trail.
// ---------------------------------------------------------------------------
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
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
  ],
).enableRLS();
