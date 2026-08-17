import { blockEnvelopeSchema } from "./block-instance";
import {
  InvalidBlockPropsError,
  MalformedBlockEnvelopeError,
  UnknownBlockError,
  blockRegistry,
  type BlockReference,
} from "./block-registry";

export interface ParsedBlock<TProps = unknown> {
  id: string;
  type: string;
  version: number;
  props: TProps;
}

/**
 * The single, total function every stored block instance passes through
 * before it is ever handed to a renderer (section 11-13 of the brief):
 * envelope shape → registry lookup → per-type/version Zod validation.
 * There is no other path from raw JSON to something a caller can trust.
 *
 * Throws (never returns a partially-valid result):
 *  - `MalformedBlockEnvelopeError` — not even `{ id, type, version, props }`-shaped.
 *  - `UnknownBlockError` — no `BlockDefinition` registered for that `type@version`.
 *  - `InvalidBlockPropsError` — registered, but `props` fails its schema.
 */
export function parseBlockInstance(raw: unknown): ParsedBlock {
  const envelopeResult = blockEnvelopeSchema.safeParse(raw);
  if (!envelopeResult.success) {
    throw new MalformedBlockEnvelopeError(
      envelopeResult.error.issues[0]?.message ?? "invalid shape",
    );
  }
  const envelope = envelopeResult.data;

  const definition = blockRegistry.get(envelope.type, envelope.version);
  if (!definition) throw new UnknownBlockError(envelope.type, envelope.version);

  const propsResult = definition.schema.safeParse(envelope.props);
  if (!propsResult.success) {
    throw new InvalidBlockPropsError(envelope.type, envelope.version, propsResult.error.issues);
  }

  return {
    id: envelope.id,
    type: envelope.type,
    version: envelope.version,
    props: propsResult.data,
  };
}

/**
 * Validates every block in a page's content document, strictly — used on
 * the WRITE path (creating/updating a Page): a page containing even one
 * invalid block instance fails to save at all, so `pages.content` never
 * holds anything `parseBlockInstance` couldn't parse back out. This is
 * deliberately stricter than the renderer's own per-block error handling
 * (see docs/adr/0014-block-registry-versioning.md) — "don't crash the
 * page" is a rendering-time resilience concern for content that already
 * made it into the database (e.g. written by an older, since-loosened
 * schema version); it is not a license to write new invalid content.
 */
export function parsePageContentStrict(raw: unknown): ParsedBlock[] {
  if (!Array.isArray(raw)) {
    throw new MalformedBlockEnvelopeError("page content must be an array of block instances");
  }
  return raw.map((item) => parseBlockInstance(item));
}

/**
 * The generic reference-extraction pass (v0.5, section 8 of the brief):
 * looks up `block`'s `BlockDefinition` and calls its own `references`
 * function, if it declared one. A block whose definition has since been
 * removed from the registry, or that never declared `references` at all,
 * simply contributes nothing — this mirrors `renderBlocks`' own
 * degrade-gracefully-per-instance philosophy (docs/RENDERING.md#error-handling)
 * rather than throwing, since reference extraction runs during publish
 * validation (packages/publishing), which already has its own explicit
 * "unknown block" issue from `parsePageContentStrict` at write time.
 */
export function extractBlockReferences(block: ParsedBlock): BlockReference[] {
  const definition = blockRegistry.get(block.type, block.version);
  if (!definition?.references) return [];
  return [...definition.references(block.props)];
}
