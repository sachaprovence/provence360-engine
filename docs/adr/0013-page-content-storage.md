# ADR 0013: Page content as a validated JSONB document, not block rows

## Status

Accepted.

## Context

Section 17 of the brief asks for an explicit choice between:

- **A.** `Page → Block` as relational rows (one row per block instance, an `ordering` column, a foreign key back to the page).
- **B.** `Page → content` as a single validated JSONB document holding an ordered array of block instances.
- A hybrid of the two.

against explicit criteria: future immutable publication, versioning,
performance, editability, migration, validation, diffing, duplication, and
future rollback (section 35: "if Release #42 must still render in six
months, how is it reproduced?").

## Decision

**B — a JSONB document** (`pages.content`, a `jsonb` array, `CHECK (jsonb_typeof(content) = 'array')` at the database level, Zod-validated on every read and write at the application level — see `docs/adr/0014-block-registry-versioning.md`).

Reasoned against each stated criterion:

- **Future immutable publication.** A future `Release` row can hold `content: jsonb` as a literal, trivial copy of the Page's content at publish time — no join to reconstruct, no risk of a later block-row edit silently mutating what a past Release rendered. This is the single strongest argument for B: with relational block rows, "freeze this page's current state" means copying N rows transactionally and keeping them forever distinguishable from the live ones (a `release_id` column, or a whole parallel table) — solvable, but exactly the complexity a document sidesteps by construction.
- **Versioning.** Each block instance already carries its own `type`/`version` (section 18); the document as a whole needs no separate version number of its own — its content _is_ its version, structurally.
- **Performance.** Rendering a page is one row read, not a join across N block rows ordered by an `ordering` column — fewer round trips, no N+1 risk from the storage shape itself (see `docs/RENDERING.md` for the actual measured query count on a seeded page).
- **Editability.** A single JSONB column update (`UPDATE pages SET content = $1`) is one statement per edit — no multi-row transaction to keep an `ordering` column consistent when a block is inserted in the middle or reordered (relational rows would need an ordering column update on every sibling, or a fractional-ordering scheme to avoid it).
- **Migration.** A future `hero@1 → hero@2` data migration (section 13) walks every Page's `content` array, upgrades matching entries in place, writes the array back — one shape to reason about, not "find every `hero` row across every page, in whatever order the block table's rows happen to be in."
- **Validation.** Every read validates the whole array against the Block Registry (`packages/content`) in one pass — an invalid or unknown block anywhere in a page is caught deterministically, not scattered across N independently-fetched rows that each need their own validation call.
- **Diff.** A structural JSON diff between two `content` arrays (a future Draft vs. Release comparison) is a well-understood, off-the-shelf problem; diffing two sets of relational rows requires first reconstructing "the array" from `ordering` on both sides anyway.
- **Duplication.** "Duplicate this page" (a future feature) is `INSERT ... SELECT content FROM pages WHERE id = $1` — one column copy, not walking and re-inserting N child rows with new ids.
- **Rollback.** Restoring a prior version is overwriting one column with a prior snapshot — no need to delete-and-reinsert a whole set of relational rows in the right order.

## Consequences

- **What's given up, honestly:** targeted SQL queries against an individual block's fields ("find every page with a Hero block whose CTA text contains X") aren't expressible as a simple `WHERE` clause — they'd need `jsonb_path_query` or an application-level scan. Not needed by anything in v0.3's scope; if a future phase needs it badly enough, a generated/indexed column or a search-specific denormalization can be added without changing the source of truth.
- **Every reader must re-validate, always** — the JSONB column is never trusted as pre-validated just because it came from the database (a stale row written by an older, less strict schema version is exactly the scenario `docs/adr/0014-block-registry-versioning.md` exists to handle safely). This is treated as the correct default, not a shortcut: the same "never trust stored JSON as typed data" discipline this codebase already applies to `sites.theme_overrides`/`navigation`/`features`.
- A hybrid was considered (relational `Page` row + a separate `page_blocks` table only for analytics/search indexing, derived from `content` rather than being the source of truth) and explicitly deferred — it's additive on top of this decision, not a reason to delay it; see `docs/ROADMAP.md`.
