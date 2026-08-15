import type { ReactElement } from "react";
import { parseBlockInstance } from "@provence360/content";
import { logger } from "@provence360/observability";
import { blockRendererRegistry } from "./block-renderer-registry";
import type { RenderContext } from "./render-context";
import { UnrenderableBlock } from "./blocks/unrenderable-block";

/**
 * Turns a Page's raw `content` array (already-stored JSONB, `unknown` at
 * this boundary) into React elements, in order (section 38 of the brief:
 * "block order respected"). Each instance is handled independently — a
 * single bad instance degrades to a placeholder (`UnrenderableBlock`),
 * it never throws and takes the rest of the page down with it. This is
 * the ONLY place block order is decided; the array's own order is
 * authoritative (see docs/adr/0013-page-content-storage.md).
 *
 * `pages.content` was already validated in full by
 * `parsePageContentStrict` at write time (packages/content), so in
 * practice every instance reaching this function should parse cleanly.
 * This function still re-validates and re-registers-lookups per instance
 * rather than trusting that invariant, because the write-time schema for
 * a block type/version can loosen or a renderer can be removed over
 * time (docs/adr/0014-block-registry-versioning.md) — content written
 * years ago must still degrade gracefully, not crash, if that ever
 * happens.
 */
export async function renderBlocks(
  rawContent: readonly unknown[],
  context: RenderContext,
): Promise<ReactElement[]> {
  const elements: ReactElement[] = [];

  for (const [index, raw] of rawContent.entries()) {
    const fallbackKey = `unrenderable-${String(index)}`;

    let parsed;
    try {
      parsed = parseBlockInstance(raw);
    } catch (error) {
      logger.warn("renderer.block.invalid", {
        index,
        error: error instanceof Error ? error.message : String(error),
      });
      elements.push(<UnrenderableBlock key={fallbackKey} blockKey={fallbackKey} />);
      continue;
    }

    const renderer = blockRendererRegistry.get(parsed.type, parsed.version);
    if (!renderer) {
      logger.warn("renderer.block.no_renderer", {
        type: parsed.type,
        version: parsed.version,
        id: parsed.id,
      });
      elements.push(<UnrenderableBlock key={parsed.id} blockKey={parsed.id} />);
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop -- block order must be preserved; rendering blocks concurrently would reorder async (domain-bound) blocks relative to sync ones.
      const element = await renderer({ id: parsed.id, props: parsed.props as never, context });
      elements.push(element);
    } catch (error) {
      logger.warn("renderer.block.render_failed", {
        type: parsed.type,
        version: parsed.version,
        id: parsed.id,
        error: error instanceof Error ? error.message : String(error),
      });
      elements.push(<UnrenderableBlock key={parsed.id} blockKey={parsed.id} />);
    }
  }

  return elements;
}
