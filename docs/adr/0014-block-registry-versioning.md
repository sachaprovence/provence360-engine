# ADR 0014: A central Block Registry, closed types, mandatory versions

## Status

Accepted.

## Context

Section 11-13 of the brief names the exact failure mode to avoid: a
renderer that grows into `if (type === "hero") ... else if (type ===
"text") ...` across hundreds of lines, where "add a block type" means
finding and editing that chain, and where a stored block's shape is
whatever the code that happened to write it assumed — cast to a
TypeScript type with no runtime check, trusted all the way to the
component tree.

The second, sharper problem: block shapes will change. `hero@1` will
become `hero@2` — new props, a renamed field, a different validation
rule. A Page written months ago, or a future immutable Release snapshot
(`docs/adr/0013-page-content-storage.md`), must still render correctly
under the _old_ shape, even after the renderer has moved on to `hero@2`.

## Decision

- **A `BlockDefinition` is the one place a block type is described**: `{ type, version, schema (Zod), render (a React component) }`. `packages/content/src/block-registry.ts` exports `registerBlock(definition)` and `blockRegistry`, a `Map` keyed by `` `${type}@${version}` ``. Registering the same `type@version` twice throws — a duplicate registration is a programming error, not a runtime edge case to silently overwrite.
- **Every block instance stored in `pages.content` carries its own stable `id`, `type`, `version`, and `props`** (section 18): `{ id: "blk_...", type: "hero", version: 1, props: {...} }`. `id` is generated once, at creation, and never regenerated on edit — it survives reordering, prop edits, and (later) type-preserving version migrations, which is what makes targeted editing, analytics, and Draft/Release diffing possible at all.
- **Parsing a stored block instance is a single, total function**: look up `` `${type}@${version}` `` in the registry; not found → a typed `UnknownBlockError` (never a thrown `TypeError` from blindly indexing into `props`); found → `schema.safeParse(props)`; invalid → a typed `InvalidBlockPropsError` carrying the Zod issues. **There is no path from raw JSON to a rendered component that skips this.** The renderer never receives `props: any` — only `props` that has already passed the registered Zod schema for that exact `type@version`, so the React component's own prop type is the Zod-inferred type, not a hand-written interface that could drift from what's actually validated.
- **An unrecognized block never crashes the page.** `packages/renderer` catches both error types per-instance and renders a small, visible "block failed to render" placeholder in that slot — the rest of the page still renders. One bad block instance (a future manual DB edit, a bug in an older writer) degrades gracefully instead of taking down an entire site. This is deliberately _not_ silent — the placeholder and a structured log line both make the failure visible, just not fatal.
- **Versioning is closed and additive, never destructive.** When `hero@2` ships, `hero@1`'s `BlockDefinition` (schema and renderer both) stays registered and functional — it is never deleted, overwritten, or "upgraded in place." A Page still holding `{ type: "hero", version: 1, ... }` keeps rendering through the `hero@1` definition indefinitely. A future in-place _migration_ (rewriting stored `hero@1` instances to `hero@2`) is an explicit, separate, opt-in operation on the stored data — never an implicit side effect of registering a new version.

## Consequences

- Adding a `video` block (brief, section 47.A) is: write one `BlockDefinition`, call `registerBlock`, done — no renderer conditional to extend, no existing code path to touch.
- Evolving `hero@1 → hero@2` (section 47.B) never breaks a Page that hasn't been explicitly migrated — old Releases keep rendering exactly as they did when published, which is the concrete, testable form of section 35's "future Release compatibility" requirement.
- The registry is the **only** place `type === "..."` string comparison happens (inside the lookup itself) — everywhere else in the codebase works against the Zod-inferred type for a specific `type@version`, not a string tag.
- Cost: every block type needs its schema and version thought through up front rather than "just adding a field" to an ad hoc shape — accepted, because the alternative is exactly the unversioned, uncheckable JSON blob section 11 warns against.
