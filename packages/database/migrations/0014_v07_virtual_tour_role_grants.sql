-- Declarative role grants for the v0.7 Virtual Tour & Immersive Experience
-- Kernel's new table. Learned directly from migration 0004's fix (see
-- docs/adr/0008-domain-resolver-grant-hardening.md): an RLS policy alone
-- grants nothing — Postgres still checks table-level privileges first, and
-- without a matching GRANT the policy is unreachable on a fresh install.
--
-- Full CRUD, same shape as `properties`/`units`/`unit_amenities`: an
-- ordinary tenant-scoped content table, mutated directly by
-- `provence360_app`, with RLS (not a withheld grant) as the actual access
-- boundary.

grant select, insert, update, delete on table public.virtual_tours to provence360_app;
