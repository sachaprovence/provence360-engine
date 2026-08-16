-- Declarative role grants (v0.2). Previously some of this was done by an
-- imperative script (packages/database/src/admin/setup-roles.ts) run by
-- hand after migrating — see docs/ROADMAP.md's now-resolved "column-level
-- grants are hand-maintained" entry and docs/adr/0008-domain-resolver-grant-hardening.md.
-- Every statement here is idempotent: GRANT/REVOKE on a privilege that's
-- already in the desired state is a no-op, not an error, so this migration
-- is safe to have run zero, one, or (via a future re-run of an older
-- snapshot in a disaster-recovery scenario) more than once.
--
-- Requires provence360_app / provence360_resolver / provence360_auth to
-- already exist, which runMigrations() guarantees by calling
-- ensureLoginRoles() before applying any migration (see
-- packages/database/src/admin/migrate.ts) — a schema migration can assume
-- its roles exist the same way migration 0000 already did for
-- `CREATE POLICY ... TO provence360_app`.

-- provence360_app: tighten `users` from the v0.1 blanket grant (full
-- table, every column) to column-restricted, excluding `password_hash`.
-- REVOKE first — a column-level GRANT can only ever *add* privileges, it
-- can't narrow an existing broader one.
revoke all on table public.users from provence360_app;
--> statement-breakpoint
grant select (id, email, name, created_at, updated_at) on table public.users to provence360_app;
--> statement-breakpoint

-- provence360_resolver: hostname -> site routing only (see
-- packages/domains/src/resolver.ts and
-- docs/adr/0005-hostname-site-resolution.md). Same columns as the old
-- imperative grant, now versioned and applied automatically.
grant select (id, tenant_id, status) on table public.sites to provence360_resolver;
--> statement-breakpoint
grant select (id, site_id, tenant_id, hostname, is_primary, status) on table public.domains to provence360_resolver;
--> statement-breakpoint

-- provence360_auth: the pre-tenant-context identity/authorization role
-- (see docs/AUTHENTICATION.md, docs/AUTHORIZATION.md).
grant select, insert, update, delete on table public.sessions to provence360_auth;
--> statement-breakpoint
grant select on table public.users to provence360_auth;
--> statement-breakpoint
grant update (password_hash, updated_at) on table public.users to provence360_auth;
--> statement-breakpoint
grant select on table public.memberships to provence360_auth;
--> statement-breakpoint
grant select (id, slug, name, status) on table public.tenants to provence360_auth;
--> statement-breakpoint
grant select, insert on table public.audit_logs to provence360_auth;
