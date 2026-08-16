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

`sites.published_revision_id` is a plain single-column FK to
`site_revisions.id`, not the composite `(tenant_id, id)` pattern every
other tenant-scoped foreign key in this schema uses. `site_revisions` is
declared later in `schema.ts` than `sites`, and Drizzle's `foreignKey()`
table-config builder needs its target's columns to already be
initialized bindings at the point it runs — a composite FK declared
inside `sites`' own config would need to reference `site_revisions`
before it exists in the module, which throws (`ReferenceError`, temporal
dead zone). A single-column `.references(() => siteRevisions.id)` avoids
this (its callback is evaluated lazily), but a _composite_ one via the
`foreignKey()` array-config helper does not.

The cross-tenant/cross-site guarantee that a composite FK would have
given at the database level is instead enforced by two independent
application-level layers inside `publishRevision` (packages/publishing):
(1) `revisionId` is re-read through the _current tenant's_ RLS-scoped
transaction before ever being written — a different tenant's revision is
structurally unreadable, not merely rejected after the fact; (2) an
explicit `revision.siteId === siteId` check, since RLS alone only scopes
by tenant, not by site. This is the same "two independent layers, either
one alone would have stopped this" reasoning already used elsewhere in
this codebase (e.g. `createSite`'s docstring in `packages/sites`) — a
deliberate, not accidental, trade-off. Tested directly:
`packages/publishing/src/rollback.test.ts`'s cross-tenant and cross-site
rejection cases.

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
- `sites.published_revision_id`'s lack of a database-level composite FK
  means a superuser (the `provence360` admin/migration role, which owns
  every table and bypasses RLS by construction — see `docs/SECURITY.md`)
  _could_ theoretically write an inconsistent pointer directly. This is
  the same trust boundary already accepted everywhere else in this
  schema (the admin connection is explicitly, documentedly the one
  exception to RLS) — not a new gap.
- Publishing a Site still requires a tenant-scoped `tx` at _render_ time
  (the public runtime), not just at publish time, because domain blocks
  (PropertySummary/UnitGrid/Amenities) query live data through it. A
  Revision snapshot is not a fully self-contained static document — it is
  "the content structure, resolved against always-current business data."
