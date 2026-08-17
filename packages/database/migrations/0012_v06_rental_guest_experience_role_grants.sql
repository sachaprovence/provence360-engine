-- Declarative role grants for the v0.6 Rental Domain & Guest Experience
-- Kernel's two new tables. Learned directly from migration 0004's fix (see
-- docs/adr/0008-domain-resolver-grant-hardening.md): an RLS policy alone
-- grants nothing — Postgres still checks table-level privileges first, and
-- without a matching GRANT every one of these policies would be
-- unreachable on a fresh install (permission denied before RLS is even
-- evaluated).
--
-- Both tables get the full CRUD grant, same shape as `properties`/`units`/
-- `unit_amenities` in migration 0005: ordinary tenant-scoped content rows,
-- mutated directly by `provence360_app`, with RLS (not a withheld grant)
-- as the actual access boundary.

grant select, insert, update, delete on table public.unit_sleeping_arrangements to provence360_app;
--> statement-breakpoint
grant select, insert, update, delete on table public.property_amenities to provence360_app;
