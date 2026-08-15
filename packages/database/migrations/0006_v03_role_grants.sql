-- Declarative role grants for the v0.3 tables. Learned directly from
-- migration 0004's fix: an RLS policy alone grants nothing — Postgres
-- still checks table-level privileges first, and without a matching GRANT
-- every one of these policies would be unreachable on a fresh install
-- (permission denied before RLS is even evaluated). See
-- docs/adr/0008-domain-resolver-grant-hardening.md and
-- migrations/0004_app_role_base_table_grants.sql for the full story.

-- Ordinary tenant-scoped content tables: full DML, same shape as
-- sites/domains/memberships.
grant select, insert, update, delete on table public.properties to provence360_app;
--> statement-breakpoint
grant select, insert, update, delete on table public.units to provence360_app;
--> statement-breakpoint
grant select, insert, update, delete on table public.unit_amenities to provence360_app;
--> statement-breakpoint
grant select, insert, update, delete on table public.media_assets to provence360_app;
--> statement-breakpoint
grant select, insert, update, delete on table public.pages to provence360_app;
--> statement-breakpoint

-- Platform-level catalogs: read-only for every tenant, no write grant at
-- all (there is no tenant-facing "create a theme"/"create an amenity"
-- capability in v0.3 — see docs/adr/0011-theme-token-model.md and
-- docs/adr/0012-media-asset-and-amenity-catalog.md). The admin/owner role
-- (table owner) can already write these; provence360_app deliberately
-- cannot.
grant select on table public.themes to provence360_app;
--> statement-breakpoint
grant select on table public.amenities to provence360_app;
