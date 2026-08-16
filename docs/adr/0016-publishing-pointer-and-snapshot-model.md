# ADR 0016: Publishing pointer model, snapshot boundary, and preview auth

## Status

Accepted.

## Context

v0.4's brief asks for `Draft → Validation → Immutable Revision →
Publication → Public Runtime`, and explicitly warns against "deux sources
de vérité concurrentes" for "what's currently published." ADR 0013 already
decided a Page's `content` is a JSONB document specifically so a future
Release/Revision could copy it verbatim — this ADR is that future
decision, plus two more this phase forced: what belongs inside a
Revision's frozen snapshot, and how "preview" is authorized.

## Decision 1 — the active-revision pointer

`sites.published_revision_id` (a single nullable column on the existing
`sites` table) is the **only** place "what's live right now" is read from.
`site_publications` is an append-only _history_ table (`revisionId`,
`previousRevisionId`, `action`, `publishedByUserId`, `createdAt`) —
useful for "when/by whom/what was live before," never consulted to answer
"what's live now." Considered and rejected: deriving "current" from
`site_publications` via `ORDER BY created_at DESC LIMIT 1` — this makes
every read of the hot path (the public runtime, on every request) a sort
over a growing table instead of a single indexed column read, and it
reintroduces exactly the two-sources-of-truth risk the brief warns
against (the "current" row and the historical log could theoretically
disagree if a write ever touched one without the other).

**Revised (post-review):** `sites.published_revision_id` is declared as a
plain column in `schema.ts` (no `.references()` at all), because
`site_revisions` is declared later in `schema.ts` than `sites`, and
Drizzle's `foreignKey()` table-config builder needs its target's columns
to already be initialized bindings at the point it runs — a composite FK
declared inside `sites`' own config would need to reference
`site_revisions` before it exists in the module, which throws
(`ReferenceError`, temporal dead zone). This is a limitation of the
Drizzle schema DSL, not of PostgreSQL itself, so it is not a reason to
leave the invariant unenforced at the database level: migration 0010
(`0010_sites_published_revision_composite_fk.sql`) hand-adds

```sql
ALTER TABLE "sites"
  ADD CONSTRAINT "sites_published_revision_tenant_site_fk"
  FOREIGN KEY ("tenant_id", "id", "published_revision_id")
  REFERENCES "site_revisions" ("tenant_id", "site_id", "id")
  ON DELETE RESTRICT;
```

against a new 3-column `UNIQUE (tenant_id, site_id, id)` constraint on
`site_revisions` (migration 0009, declared in `schema.ts` normally — no
forward-reference problem in that direction). Column correspondence:
`sites.tenant_id → site_revisions.tenant_id`, `sites.id →
site_revisions.site_id`, `sites.published_revision_id →
site_revisions.id`. Whenever `published_revision_id` is non-null,
Postgres now requires a `site_revisions` row that matches on _all three_
— a revision belonging to a different tenant, or to a different Site in
the same tenant, is a `23503 foreign_key_violation`, raised by Postgres
itself, for every role including the admin/superuser connection
(referential integrity is never bypassed by table ownership, unlike Row-
Level Security). `MATCH SIMPLE` (Postgres's default) means the constraint
is skipped entirely when any referencing column is NULL; since
`tenant_id`/`id` on `sites` are always `NOT NULL`, the only column that
can ever be NULL is `published_revision_id` itself, which correctly
leaves "never published" unconstrained.

`ON DELETE RESTRICT` (not `CASCADE`, not `SET NULL`): a Revision can
never actually be deleted by `provence360_app` (no DELETE RLS policy),
but the admin connection owns the table and could attempt it — RESTRICT
refuses to delete a Revision that is _currently_ published rather than
silently nulling the pointer (which would make a live Site vanish from
the public runtime with no record of why) or cascading (nonsensical —
deleting a Revision doesn't imply the Site should be deleted too).

This was originally shipped (first version of this ADR, and the PR that
introduced `packages/publishing`) relying only on two independent
application-level layers inside `publishRevision`: (1) `revisionId`
re-read through the _current tenant's_ RLS-scoped transaction before
ever being written — a different tenant's revision is structurally
unreadable, not merely rejected after the fact; (2) an explicit
`revision.siteId === siteId` check, since RLS alone only scopes by
tenant, not by site. Both checks remain in place — they are cheap, they
give an immediate, typed application error (`RevisionNotFoundError`)
instead of a raw Postgres constraint violation, and they follow this
codebase's established "two independent layers, either one alone would
have stopped this" pattern (e.g. `createSite`'s docstring in
`packages/sites`) — but a follow-up hardening review (see git history)
judged that relying on application code and RLS alone, with no
database-level backstop at all, for a constraint PostgreSQL itself is
fully capable of expressing, understated the codebase's own "the
database is the actual, unconditional backstop" philosophy
(`docs/SECURITY.md#defense-in-depth`). The composite FK above is that
backstop. Tested directly: `packages/publishing/src/db-constraints.test.ts`
(the FK itself, via both the admin connection and the real app-role write
path) and `packages/publishing/src/rollback.test.ts` (the application-
level checks, exercised through the real `rollbackSite` primitive).

## Decision 2 — what a Revision snapshot freezes

Per `docs/SITE_DOMAIN.md#future-release-compatibility` (written in v0.3
specifically to make this decision non-breaking): a Page's `content`
(block array) and the Site's own presentation fields are **snapshotted**;
`Property`/`Unit`/`Amenity` business data is **referenced live**, even
from an old Revision. Theme tokens are resolved and frozen at
publish time (not a live `themeId` reference) — the only place this ADR
adds a _new_ freezing decision beyond what v0.3 already called: a Site's
theme is tenant-facing configuration, changeable at any time via
`updateSiteTheme`, and letting a later re-theme retroactively repaint an
already-published Revision would violate "an old Revision renders
exactly as it did when published" as surely as an uncontrolled Property
edit would — except Property data is explicitly exempted by the v0.3 ADR
for a different reason (it's presented as "today's" data on purpose, like
a brochure's phone number), while a theme has no equivalent "meant to be
current" framing anywhere in `docs/THEMES.md`.

## Decision 3 — preview without a token

Considered: a cryptographically random, expiring, revocable preview
token (the brief explicitly allows this: "si un token de preview est
utilisé"). Rejected in favor of reusing the existing admin session +
Membership + permission chain (`withTenantPage(tenantId, "release.read",
...)`) unchanged — the same chain every other admin route already goes
through. A token would be a second, parallel authentication mechanism
with its own storage, expiry, and revocation to build correctly (exactly
the "ne crée pas une deuxième architecture d'auth" the brief separately
prohibits), to satisfy a preview requirement the existing session auth
already satisfies in full: never accessible by UUID alone, real
server-side authorization, correct tenant context, no RLS bypass. The
traded-off capability is a shareable preview link a teammate without an
admin account could open — not needed by anything in v0.4's scope, and
additive (not a redesign) if a future phase needs it.

## Consequences

- A revision's `snapshot` JSONB round-trips through Postgres without
  preserving JS object key insertion order — `hasUnpublishedChanges`
  (comparing a freshly built draft snapshot against a stored one) cannot
  use a plain `JSON.stringify` equality check; `packages/publishing/src/
snapshot-equal.ts` recursively canonicalizes key order first. Found and
  fixed via a failing test during this phase's own verification
  (`draft-service.test.ts`), not discovered in review after the fact.
- With the composite FK in place (migration 0010), even the admin/
  migration connection — which owns every table and bypasses RLS by
  construction (see `docs/SECURITY.md`) — cannot write an inconsistent
  `published_revision_id`. Referential integrity, unlike RLS, is not a
  privilege table owners bypass. This closes what the first version of
  this ADR had accepted as a trust-boundary trade-off.
- Publishing a Site still requires a tenant-scoped `tx` at _render_ time
  (the public runtime), not just at publish time, because domain blocks
  (PropertySummary/UnitGrid/Amenities) query live data through it. A
  Revision snapshot is not a fully self-contained static document — it is
  "the content structure, resolved against always-current business data."
