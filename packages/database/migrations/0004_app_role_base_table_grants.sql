-- Fixes a real gap discovered during Foundation v0.3's baseline
-- verification (a fresh-install "zero -> latest" test, run against a
-- brand-new database rather than this sandbox's long-lived
-- provence360_dev/provence360_test): `provence360_app` had NO grant at
-- all on `tenants`, `memberships`, `sites`, `domains`, or `audit_logs` on
-- a freshly created database — every RLS policy on those tables was
-- unreachable, and every request would have failed with "permission
-- denied" before RLS was even evaluated.
--
-- Root cause: v0.1's original `setup-roles.ts` issued these grants
-- imperatively (a blanket per-table GRANT, run once by hand after
-- migrating). When v0.2 refactored role grants to be declarative and
-- versioned (see migration 0003 and docs/adr/0008-domain-resolver-grant-hardening.md),
-- migration 0003 only re-declared the grants that *changed* — `users`
-- (tightened to exclude password_hash) and the new resolver/auth roles —
-- but never re-declared the *unchanged* base grants on the original five
-- tables, since they already existed live on this sandbox's databases and
-- so no test ever exercised a database that didn't already have them.
-- `provence360_dev`/`provence360_test` here have carried that original
-- v0.1 imperative grant as inherited, undocumented state ever since,
-- masking the gap in every `pnpm verify` run until a genuinely fresh
-- database was tested.
--
-- Idempotent, like every grant migration: safe to run zero, one, or more
-- than once.

grant select, insert, update, delete on table public.tenants to provence360_app;
--> statement-breakpoint
grant select, insert, update, delete on table public.memberships to provence360_app;
--> statement-breakpoint
grant select, insert, update, delete on table public.sites to provence360_app;
--> statement-breakpoint
grant select, insert, update, delete on table public.domains to provence360_app;
--> statement-breakpoint
grant select, insert, update, delete on table public.audit_logs to provence360_app;