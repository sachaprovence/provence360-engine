# Publishing & Versioning Kernel

v0.4 inserts a real staging step between "an admin edited something" and
"a visitor sees it": `Draft → Validation → Immutable Revision →
Publication → Public Runtime`. Before this, every v0.3 Site Editor edit
was live immediately (`docs/ROADMAP.md`'s own "known gap"). This document
is the ADR-level explanation of the model; `packages/publishing` is the
implementation.

## The four concepts

**Draft** — the Site's current, mutable, editable state. Deliberately
**not** a new table: it is exactly the same `sites`/`pages` rows the v0.3
Site Editor already reads and writes (`packages/sites`, `packages/content`).
A second, parallel "draft" copy of the same content would be pure
duplication — the mutable rows already _are_ the draft, by definition.
`packages/publishing/src/draft-service.ts`'s `getDraftSummary` is the one
new read: "does this Site have changes that aren't live yet, and what's
currently published."

**Revision** (`site_revisions`) — an immutable snapshot, created by
`createRevisionFromDraft`. Holds:

- `revisionNumber` — monotonic per Site, starting at 1.
- `snapshot` (JSONB) — the Site's presentation fields, its fully _resolved_
  theme tokens (not a live `themeId` reference — see below), and every
  `active` Page's validated block content, ordered by slug.
- `createdByUserId`, `createdAt`.

Append-only at the database level: `site_revisions` has SELECT and INSERT
RLS policies for `provence360_app` and **no UPDATE/DELETE policy at all**
— the exact same pattern `audit_logs` already uses. A coding mistake that
tried to `UPDATE site_revisions` would affect zero rows, not corrupt
history.

**Publication** (`sites.published_revision_id` + `site_publications`) —
two distinct things, deliberately not conflated (the brief's own warning:
"avoid two sources of truth"):

- `sites.published_revision_id` is the **single** source of truth for
  "what's live right now." One column, one UPDATE statement, trivially
  fast to read.
- `site_publications` is a purely historical, append-only log of publish/
  rollback _events_ (`revisionId`, `previousRevisionId`, `action`,
  `publishedByUserId`, `createdAt`). It is never consulted to answer "what's
  live" — only "when was X published, by whom, what was live before."

## What gets snapshotted, what stays live

Per `docs/SITE_DOMAIN.md#future-release-compatibility` (written in v0.3,
specifically to make this addition non-breaking):

- **Snapshotted**: a Page's `content` (block array), the Site's
  presentation fields, the fully resolved theme tokens.
- **Referenced live, even from an old Revision**: `Property`/`Unit`/
  `Amenity` data. A `PropertySummary`/`UnitGrid`/`Amenities` block always
  shows _today's_ business data — the same way a printed brochure with a
  phone number on it doesn't freeze the phone number's meaning. The public
  runtime therefore still needs a tenant-scoped `tx` to render (domain
  blocks query live rows through it), even though the _content structure_
  it renders comes from an immutable snapshot, not `pages` directly.

Theme tokens are resolved (`resolveTheme(baseTokens, overrides)`) and
frozen at Revision-creation time, not referenced by `themeId` — a later
re-theme of the Site can never retroactively change how an already-
published Revision looked.

## Validation before publish

`packages/publishing/src/draft-snapshot.ts`'s `assembleDraft` is a single
function that both validates _and_ builds the snapshot in one pass — not
two separate passes — specifically to avoid a race where a concurrent edit
could land between a "validate" read and a later "snapshot" read (see
Concurrency below). It checks:

- the Site exists and belongs to the current tenant;
- at least one `active` Page has `pageType: "home"` (the public runtime's
  `/` route has nothing to render otherwise);
- every `active` Page's `content` still parses via `parsePageContentStrict`
  (re-validated, not trusted — a block registry can loosen/tighten over
  time, see `docs/adr/0014-block-registry-versioning.md`);
- the theme resolves without throwing.

A `draft`/`archived` Page is excluded from the snapshot — `pageStatusValues`
already existed precisely so an author can keep a Page out of the next
publish without deleting it.

Failure returns structured issues (`{ code, message, pageId? }`), never a
generic exception — `createRevisionFromDraft` throws
`PublishValidationError(issues)` carrying all of them, and the admin
Publishing page renders the full list.

## Publish and rollback

`publishSite(tx, { siteId, actorUserId })` = `createRevisionFromDraft` +
`publishRevision(..., action: "publish")`. `rollbackSite(tx, { siteId,
targetRevisionId, actorUserId })` = `publishRevision(..., action:
"rollback")` directly — it never creates a new Revision, only re-points
`published_revision_id` at an existing, already-immutable one. Both run
inside the caller's own transaction (`withAuthorizedTenantContext`'s) —
neither opens a transaction of its own — so a mid-flight failure (a
validation error, a thrown exception) leaves the previous publication
exactly as it was. There is no state where a partial publish is
observable.

### Concurrency

`publishRevision` (shared by both) starts with
`SELECT ... FOR UPDATE` on the Site row — the same pattern
`packages/auth/src/membership-repository.ts`'s owner-invariant check
already uses. Two concurrent `publishSite`/`rollbackSite` calls on the
_same_ Site serialize on this lock: the second always sees the first's
committed `published_revision_id` as its own `previousRevisionId`, never a
stale one. `createRevisionFromDraft` takes the same lock independently
(for `revisionNumber` computation), so it is race-safe even called on its
own.

### Cross-tenant / cross-site safety

`publishRevision` re-reads `revisionId` through the _current tenant's_
RLS-scoped `tx` before ever writing it into `published_revision_id` — a
different tenant's Revision id simply does not exist from that query's
point of view (RLS denies the row), so it is structurally unreadable, not
merely rejected after the fact. A second, independent check
(`revision.siteId === siteId`) catches the narrower case RLS alone can't:
a Revision belonging to a _different Site in the same tenant_.
`sites.published_revision_id` is a plain single-column FK to
`site_revisions.id` (not the composite `(tenant_id, id)` pattern used
elsewhere — `site_revisions` is declared later in `schema.ts`, and a
forward composite reference there hits Drizzle's declaration-order
limits); the tenant/site guarantee is enforced by the two checks above,
the same "two independent layers" reasoning already used throughout this
schema (e.g. `createSite`'s docstring).

## Draft concurrency (optimistic, opt-in)

Separate from publish/rollback's row-lock serialization: editing the draft
itself (a Page's content, a Site's settings) can race across two browser
tabs/admins. `packages/content`'s `updatePageMeta`/`addBlock`/
`updateBlockProps`/`removeBlock`/`reorderBlocks` and `packages/sites`'s
`updateSiteSettings` all accept an optional `expectedUpdatedAt: Date` — a
compare-and-swap: the UPDATE's `WHERE` clause requires the row's current
`updatedAt` to still match, and a caller that passed it gets
`PageConflictError`/`SiteConflictError` instead of a silent overwrite when
it doesn't. Every v0.3 call site omits it and keeps its original
unconditional last-write-wins behavior — this is purely additive.

The comparison truncates both sides to millisecond precision
(`date_trunc('milliseconds', ...)`) rather than a plain `=`: a row's
_first_ `updatedAt` comes from Postgres's own `now()` (microsecond
precision, via `defaultNow()`), but every value a JS caller can ever hold
(`$onUpdate(() => new Date())`, or a value read back through the
`postgres` driver into a JS `Date`) only carries millisecond precision. An
untruncated comparison would spuriously reject a _correct_ token whenever
the stored value's microseconds happened to be non-zero.

## Preview

An authorized user views the current **draft** — not a Revision, not the
published site — through `apps/admin/.../sites/[siteId]/preview`, gated by
`withTenantPage(tenantId, "release.read", ...)`: the exact same session +
Membership + permission chain every other admin page goes through. It
renders through the same `packages/renderer` code the public runtime uses,
against the live `pages`/`sites` rows, so "preview" and "what publishing
would freeze" can never structurally drift apart.

Deliberately **no preview token / shareable link**: the brief allows one
("si un token de preview est utilisé") but doesn't require it, and a
token would be a second, parallel authentication mechanism to build,
store safely, expire, and revoke — exactly the "ne crée pas une deuxième
architecture d'auth" the brief warns against. Reusing the existing
session-based admin auth is the simplest solution that satisfies every
stated preview requirement (never public by UUID alone, server-side
authorization, correct tenant context, no RLS bypass) with zero new
surface. The traded-off capability — no link a teammate without an admin
account could open — is the one documented gap; see Risks below.

## Public runtime

`apps/web/app/page.tsx`: `Host → DomainResolver → Site → Published
Revision → Renderer`. The one read is
`packages/publishing`'s `getPublishedRevision(tx, siteId)`, which resolves
`sites.published_revision_id` and returns its Revision's snapshot, or
`null`. The route never queries `pages` directly and never accepts a
`tenantId` from anything the browser sends — the resolver's hostname
lookup remains the only source of truth for tenant, unchanged from v0.1.

A Site with no publication (`published_revision_id IS NULL`) — or whose
published Revision has no `home` page in its frozen snapshot — 404s: the
same deterministic response an unresolvable hostname already produced
pre-v0.4, so "never published" is indistinguishable from "domain doesn't
resolve." No new information leak about a tenant's setup progress.

## Permissions

No new permission catalog entries. `release.read` and `release.publish`
were declared in v0.1/v0.2's catalog (`packages/auth/src/permissions.ts`)
but unused until now — `release.read` gates draft-status/history/preview,
`release.publish` gates `publishSite`/`rollbackSite`, both already mapped
per `MembershipRole` (member: read-only; admin/owner: publish too — see
`docs/AUTHORIZATION.md`). Editing the draft is exactly the pre-existing
`page.update`/`site.update`/`theme.update` — no new permission needed
there either.

## Observability

`packages/publishing` logs (`@provence360/observability`'s structured
logger) on: revision creation (`publishing.revision.created`), publish/
rollback (`publishing.site.publish` / `publishing.site.rollback`), and
validation failure (`publishing.revision.validation_failed`, `warn`
level). Every log line carries `tenantId`/`siteId`/`revisionId` — never a
session token, a password, or page content. Every mutating call also
writes an `audit_logs` row (`SITE_REVISION_CREATED`, `SITE_PUBLISHED`,
`SITE_ROLLED_BACK`) through the existing `recordAuditLog`, visible on the
tenant's own Audit Log page.

## Risks / deliberately out of scope

- **No shareable preview link.** Preview requires a real admin session —
  see above. A future token-based "share this preview with a client" flow
  is additive, not a redesign, if it's ever needed.
- **No scheduled/future-dated publish.** `publishSite` always publishes
  immediately; there is no "publish at 9am tomorrow."
- **No diff view between Revisions.** The admin History page lists
  Revisions/publications; it doesn't render a content diff between two of
  them.
- **`Property`/`Unit`/`Amenity` changes are never versioned.** By design
  (see "What gets snapshotted" above) — this is the same boundary v0.3's
  own ADR already drew, not a new gap v0.4 introduces.
- **Draft optimistic-concurrency is per-Page/per-Site, not a single
  Site-wide draft version counter.** Two edits to _different_ Pages on the
  same Site never conflict with each other, even though both count toward
  the same Site's "has unpublished changes." This matches the real editing
  granularity (an admin edits one Page at a time) rather than adding a
  coarser, more contentious lock.
