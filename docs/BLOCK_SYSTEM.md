# Block System

The Block Registry is the one place a block type is described, and the
only path from raw stored JSON to a trusted, typed value. See
[ADR 0014](adr/0014-block-registry-versioning.md) for the full reasoning
behind this design; this document is the reference for how it actually
works and how to add a block.

## Two registries, one contract

There are deliberately **two** separate registries, in two separate
packages:

- **`packages/content`'s `blockRegistry`** (`block-registry.ts`) — knows
  `{ type, version, schema (Zod), capabilities }`. No React, no rendering
  — this is what validates stored content, and it's what a future
  non-renderer consumer (an export job, a search indexer) could use
  without pulling in React at all.
- **`packages/renderer`'s `blockRendererRegistry`** (`block-renderer-registry.ts`)
  — knows `{ type@version → React component }`. This is the _only_ place
  in the codebase that imports both a block's type key and React for it.

Both are singleton `Map`-backed registries, populated once via an
import-time side effect (`packages/content/src/blocks/index.ts` and
`packages/renderer/src/blocks/index.ts` respectively) — ES modules are
evaluated once per process, so importing either barrel from multiple call
sites registers everything exactly once, never re-throwing a duplicate
registration error on a second import.

Registering the same `type@version` twice in either registry throws
(`DuplicateBlockRegistrationError` / `DuplicateBlockRendererError`) — a
duplicate registration is a programming error to catch immediately, not a
runtime edge case to silently overwrite.

## BlockDefinition

```ts
interface BlockDefinition<TProps> {
  type: string;
  version: number;
  schema: z.ZodType<TProps>;
  capabilities: { domainBound: boolean };
}
```

`capabilities.domainBound` is the one flag that distinguishes a **content
block** from a **domain block** — see below.

## Parsing: the one path from JSON to trusted data

`packages/content/src/parse-block.ts`'s `parseBlockInstance(raw: unknown)`
is total and linear:

1. `raw` must match the envelope shape (`{ id, type, version, props }`) —
   else `MalformedBlockEnvelopeError`.
2. `` `${type}@${version}` `` must be registered — else `UnknownBlockError`.
3. `props` must pass that `type@version`'s own Zod schema — else
   `InvalidBlockPropsError` (carrying the Zod issues).

There is **no other path**. Nothing in this codebase blind-casts stored
JSON to a block's TypeScript type — the type a renderer component receives
is always the Zod-inferred type of the schema that just validated it, not
a hand-written interface that could silently drift from what's actually
checked.

`parsePageContentStrict` runs this over an entire `content` array,
all-or-nothing — used on the write path (see
[docs/CONTENT_MODEL.md](CONTENT_MODEL.md)).

## The 8 built-in blocks

| Type                 | Domain-bound? | Purpose                                                               |
| -------------------- | ------------- | --------------------------------------------------------------------- |
| `hero@1`             | no            | Headline, subheadline, optional background `MediaAsset`, optional CTA |
| `text@1`             | no            | Heading + plain-text body (paragraphs split on `\n`)                  |
| `gallery@1`          | no            | An ordered list of `MediaAsset` references + caption                  |
| `feature-list@1`     | no            | Heading + a list of icon/title/description items                      |
| `cta@1`              | no            | Heading/body + one button (label + safe href)                         |
| `property-summary@1` | **yes**       | References one `Property`                                             |
| `unit-grid@1`        | **yes**       | References one `Property`'s `Unit`s (optionally a subset/order)       |
| `amenities@1`        | **yes**       | References one `Unit`'s attached catalog Amenities                    |

## Content blocks vs. domain blocks

A **content block**'s `props` fully describe what to render — a Hero's
headline is _in_ its props. A **domain block**'s `props` hold only a
_reference_ (a `propertyId`, a `unitId`) plus presentation options
(`showDescription`, `columns`, ...) — **never** a copy of the Property's
name, capacity, photos, or amenities. The actual business data is loaded
at render time, scoped to the current tenant, from `packages/rentals`
(see [docs/RENDERING.md](RENDERING.md)) — the Rental domain stays the
single source of truth, and editing a Property's name updates every block
that references it, instantly, with no content migration.

This is enforced by convention (the schema for `unit-grid@1`, for example,
is literally `{ propertyId, unitIds?, columns }` — there's no field to put
a unit's name in even if a caller wanted to), and verified directly by a
Block Registry test asserting `capabilities.domainBound` per type.

## Versioning: closed, additive, never destructive

When a hypothetical `hero@2` ships, `hero@1`'s definition (schema _and_
renderer) stays registered, unchanged, forever. A Page still holding
`{ type: "hero", version: 1, ... }` keeps rendering through `hero@1`
indefinitely — nothing implicitly migrates it. A future in-place migration
(rewriting stored instances from one version to another) is an explicit,
separate, opt-in operation on stored data, never a side effect of adding
the new version.

Concretely, this means:

- Adding a `video` block is: write one `BlockDefinition` + one React
  renderer, register both, done — no existing conditional to extend.
- `hero@1 → hero@2` never breaks a Page that hasn't been explicitly
  migrated, and a future immutable Release snapshot keeps rendering
  exactly as it did when published (see
  [docs/SITE_DOMAIN.md](SITE_DOMAIN.md#future-release-compatibility)).

## Error handling: an unrecognized block never crashes the page

`packages/renderer`'s `renderBlocks()` handles each stored instance
independently. Any failure at any stage — a malformed envelope, an unknown
`type@version`, props that fail their schema, or a `type@version` that's
registered in `packages/content` but has no matching React renderer
registered in `packages/renderer` — degrades to a small, inert placeholder
(`<section data-block="unrenderable" ...>`) in that slot. Every other
block on the page still renders, in order. The failure is also logged
(`renderer.block.invalid` / `.no_renderer` / `.render_failed`), so it's
visible operationally without being fatal to the request. See
[docs/RENDERING.md](RENDERING.md#error-handling) for the full renderer
contract.

## Adding a new block type

1. `packages/content/src/blocks/your-block.ts` — define the Zod props
   schema and the `BlockDefinition` (pick `domainBound` honestly).
2. Register it in `packages/content/src/blocks/index.ts`.
3. `packages/renderer/src/blocks/your-block.tsx` — a React component
   matching the `BlockRenderer<TProps>` signature. For a domain-bound
   block, load real data through `packages/rentals`, scoped by
   `context.tx` (already tenant-scoped — see
   [docs/RENDERING.md](RENDERING.md)).
4. Register it in `packages/renderer/src/blocks/index.ts`.
5. Add it to the Block Registry test's "known blocks" list and a renderer
   test exercising it.

No renderer conditional, no admin UI change required — the Site Editor's
"add a block" picker already enumerates `blockRegistry.list()`.
