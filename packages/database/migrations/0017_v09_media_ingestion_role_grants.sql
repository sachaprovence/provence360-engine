-- Declarative role grants for the v0.9 Media Ingestion, Asset Lifecycle &
-- Delivery Kernel's new table. Same lesson as migration 0008/0012/0014: an
-- RLS policy alone grants nothing — Postgres still checks table-level
-- privileges first, and without a matching GRANT the policy is
-- unreachable on a fresh install. `media_assets` itself already has full
-- CRUD granted since migration 0006; only the new `media_uploads` table
-- needs one here.

grant select, insert, update, delete on table public.media_uploads to provence360_app;
