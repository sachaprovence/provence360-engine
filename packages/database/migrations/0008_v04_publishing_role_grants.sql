-- Declarative role grants for the v0.4 Publishing & Versioning Kernel
-- tables (see migration 0004's discovery and docs/adr/0008-domain-resolver-grant-hardening.md:
-- an RLS policy alone grants nothing — Postgres checks table-level
-- privileges first, and without a matching GRANT every one of these
-- policies is unreachable on a fresh install).
--
-- Both tables get the full CRUD grant, exactly like `audit_logs` in
-- migration 0004: immutability/append-only-ness is enforced by RLS having
-- no UPDATE/DELETE policy at all for `provence360_app` (see schema.ts), not
-- by withholding the table-level grant. This is the established pattern in
-- this codebase for "this table may never be mutated after insert."

grant select, insert, update, delete on table public.site_revisions to provence360_app;
--> statement-breakpoint
grant select, insert, update, delete on table public.site_publications to provence360_app;
