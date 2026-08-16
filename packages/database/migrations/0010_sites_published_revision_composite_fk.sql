-- Hand-written (not drizzle-kit generated): a composite foreign key from
-- `sites(tenant_id, id, published_revision_id)` to `site_revisions
-- (tenant_id, site_id, id)`. Drizzle's schema DSL cannot express this —
-- `site_revisions` is declared after `sites` in schema.ts, and the
-- `foreignKey()` table-config helper needs its target's columns to
-- already be initialized bindings when it runs, which a forward
-- reference from `sites`' own config can't satisfy (see the comment on
-- `sites.publishedRevisionId` in schema.ts and ADR 0016). A Drizzle
-- limitation is not a reason to leave PostgreSQL unable to enforce this
-- invariant, so it's added here directly.
--
-- What this guarantees, at the database level, independent of RLS and of
-- every application-level check in packages/publishing: whenever
-- `sites.published_revision_id` is not null, there must exist a row in
-- `site_revisions` with the *same* `tenant_id` AND the *same* `site_id`
-- (`sites.id`) AND that `id`. A revision belonging to a different tenant,
-- or to a different Site within the same tenant, cannot be written into
-- `published_revision_id` — Postgres rejects the UPDATE/INSERT with a
-- 23503 foreign_key_violation, full stop, even from the admin/superuser
-- connection (referential integrity constraints, unlike Row-Level
-- Security, are never bypassed by table ownership).
--
-- NULL handling: this FK uses Postgres's default MATCH SIMPLE, under
-- which a composite FK is satisfied (not checked at all) if *any* of its
-- referencing columns is NULL. `tenant_id` and `id` on `sites` are always
-- NOT NULL (they're the site's own identity), so the only column that can
-- ever be NULL is `published_revision_id` itself — exactly the "never
-- published yet" case this must allow. There is no way under MATCH SIMPLE
-- for a *set* published_revision_id to slip past unchecked, since the
-- other two columns are structurally never NULL.
--
-- ON DELETE RESTRICT: a `site_revisions` row can never actually be
-- deleted by `provence360_app` (no DELETE RLS policy — see schema.ts),
-- but the admin/migration connection owns every table and could
-- technically attempt it. RESTRICT means Postgres refuses to delete a
-- Revision that is *currently* some Site's published one, rather than
-- silently nulling the pointer (SET NULL — would make a live site vanish
-- from the public runtime with no record of why) or cascading the delete
-- (CASCADE — nonsensical here; deleting a Revision doesn't mean the Site
-- itself should be deleted). This preserves both the append-only history
-- invariant and "the public runtime always has an intact pointer or a
-- deliberate NULL," never a dangling one.
--
-- The target unique constraint (site_revisions_tenant_site_id_uidx) was
-- added by migration 0009, immediately before this one.

ALTER TABLE "sites"
  ADD CONSTRAINT "sites_published_revision_tenant_site_fk"
  FOREIGN KEY ("tenant_id", "id", "published_revision_id")
  REFERENCES "site_revisions" ("tenant_id", "site_id", "id")
  ON DELETE RESTRICT;
