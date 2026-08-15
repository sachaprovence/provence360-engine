# Content Model

How a `Page` is structured, stored, and mutated. See
[docs/BLOCK_SYSTEM.md](BLOCK_SYSTEM.md) for the Block Registry a Page's
content is validated against, and [docs/RENDERING.md](RENDERING.md) for
how it becomes HTML.

## Page

`pages`: `id`, `tenantId`, `siteId` (composite FK to `sites(tenant_id,
id)` — [docs/SITE_DOMAIN.md](SITE_DOMAIN.md#ownership-consistency-db-constraints-not-only-rls)),
`slug` (unique per `(siteId, slug)`), `internalName`, `status`
(draft/active/archived), `pageType` (home/standard/property/unit/contact),
`seo` (JSONB — see below), `content` (JSONB array of block instances),
timestamps.

- A **HOME** page's `slug` is conventionally the empty string (`""`) — it
  is the Site's root, `/`. This is enforced by a partial unique index
  (`pages_site_home_uidx`, `WHERE page_type = 'home'`): a Site can have at
  most one HOME page, but any number of `standard`/`property`/`unit`/
  `contact` pages.
- `pageType` exists so future rendering/routing/SEO logic can specialize
  behavior (e.g. a PROPERTY page auto-injecting a canonical structured-data
  block) without a giant `if (page.slug === ...)` chain anywhere — v0.3
  itself doesn't yet build type-specific logic beyond the HOME uniqueness
  rule, but the classification is in place for when it does.

## Content storage: a validated JSONB document

`pages.content` is a `jsonb` array — `CHECK (jsonb_typeof(content) =
'array')` at the database level — holding an ordered list of block
instances, **not** relational block rows. This was an explicit choice
against 9 stated criteria (future immutable publication, versioning,
performance, editability, migration, validation, diff, duplication,
rollback) — see [ADR 0013](adr/0013-page-content-storage.md) for the full
reasoning; the short version is that "freeze this Page's current state for
a future Release" is a trivial column copy with a document, and a
non-trivial multi-row transaction with relational rows.

The JSONB column is **never trusted as pre-validated**, regardless of who
or what wrote it — every read re-validates through the Block Registry
(below), the same discipline this codebase already applies to
`sites.themeOverrides`/`navigation`/`features`.

## Block instance shape

Every entry in `content` is an **envelope**:

```json
{ "id": "blk_...", "type": "hero", "version": 1, "props": { "...": "..." } }
```

- **`id`** — a stable instance id (`blk_${randomUUID()}`,
  `packages/content/src/block-instance.ts`), generated once at creation
  and never regenerated across edits, reorders, or (future) version
  migrations. This is what makes targeted editing, per-block analytics,
  and Draft/Release diffing possible at all — without it, "which block did
  the editor change" would only be answerable by structural diffing.
- **`type` / `version`** — together select exactly one registered
  `BlockDefinition` (see [docs/BLOCK_SYSTEM.md](BLOCK_SYSTEM.md)). Neither
  is inferred from `props` — a block can never "spoof" its own type by
  shaping its `props` a certain way, since `type`/`version` are read and
  validated independently of `props` before `props` is ever parsed.
- **`props`** — `unknown` at the envelope layer; validated against the
  registered `type@version`'s own Zod schema before anything downstream
  ever sees it as a typed value.

## Reading and writing content

`packages/content/src/page-repository.ts` exposes:

- `createPage` / `updatePageMeta` / `deletePage` / `getPage` /
  `getPageBySlug` / `listPagesForSite` — ordinary tenant-scoped CRUD, same
  ownership-check pattern as `packages/rentals`.
- `addBlock` / `updateBlockProps` / `removeBlock` / `reorderBlocks` — the
  content mutations. Because `content` is one JSONB column, every mutation
  is **read-modify-write**: load the page, transform the _entire_ array in
  memory, re-validate the _entire_ resulting array via
  `parsePageContentStrict` (defense in depth — even a mutation helper with
  a latent bug can't write back something the registry wouldn't accept),
  write the whole array back in one `UPDATE`.
  - `reorderBlocks` takes the **full**, permuted list of instance ids —
    never a single "move up/down" operation for the server to interpret —
    and rejects a partial list or an unknown id outright
    (`InvalidReorderError`) rather than silently dropping blocks.
- Two validation strictness levels, both real:
  - **`parsePageContentStrict`** (write path) — all-or-nothing; a Page can
    never be _created or mutated_ into holding even one invalid block.
  - **The renderer's per-block handling** (read/render path) —
    graceful degradation; a page that somehow already holds an invalid or
    unrecognized block (an old Release, a manual DB edit, a registry that
    later loosened) still renders everything else. See
    [docs/RENDERING.md](RENDERING.md#error-handling).

## SEO

`pages.seo` is a small, validated contract
(`packages/content/src/seo.ts`), not a full SEO engine: `title` /
`description` (both `LocalizedString` — see
[docs/LOCALIZATION.md](LOCALIZATION.md)), `canonicalPath`, `noIndex`,
`noFollow`, `ogImageMediaId` (a `MediaAsset` reference, never a bare URL).
The renderer produces `<title>`/`<meta>` tags from this validated data —
never from unvalidated free text.

## Slugs

Every slug in this system (Site, Property, Unit, Page) goes through the
one centralized utility, `packages/validation/src/slug.ts` — see its own
section in [docs/SITE_DOMAIN.md](SITE_DOMAIN.md) and the dedicated test
suite (`slug.test.ts`, 30+ cases: accents, apostrophes, whitespace,
punctuation runs, non-Latin scripts, empty input, reserved words, and
explicit path-traversal-sequence normalization). `toSlug()` normalizes and
validates in one step; `normalizeSlug()` is the pure normalization
function it's built on. Collision handling is deliberately **not** this
utility's job — a duplicate slug is a database unique-index violation
(`sites_tenant_id_slug` style indexes, `pages_site_slug_uidx`,
`properties_site_slug_uidx`, `units_property_slug_uidx`), surfaced as a
distinct, catchable error at the repository layer, never silently resolved
by auto-appending `-2` (which would make slugs non-deterministic).
