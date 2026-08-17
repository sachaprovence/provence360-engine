import { listMediaAssetsByIds } from "@provence360/content";
import type { FrozenMediaDescriptor, RenderContext } from "./render-context";

/**
 * The one place a block resolves a referenced MediaAsset id to a
 * renderable descriptor — shared by `hero.tsx`/`gallery.tsx` so the
 * "frozen manifest if published, live lookup if previewing a Draft"
 * branch (see `RenderContext.media`'s own doc comment) exists in exactly
 * one place, not duplicated per block.
 */
export async function resolveMediaDescriptor(
  id: string,
  context: RenderContext,
): Promise<FrozenMediaDescriptor | null> {
  if (context.media) return context.media.get(id) ?? null;
  const [row] = await listMediaAssetsByIds(context.tx, [id]);
  return row ?? null;
}

/** Batched variant for a block (Gallery) that references several ids at once. */
export async function resolveMediaDescriptors(
  ids: readonly string[],
  context: RenderContext,
): Promise<Map<string, FrozenMediaDescriptor>> {
  if (context.media) {
    const found = new Map<string, FrozenMediaDescriptor>();
    for (const id of ids) {
      const descriptor = context.media.get(id);
      if (descriptor) found.set(id, descriptor);
    }
    return found;
  }
  const rows = await listMediaAssetsByIds(context.tx, ids);
  return new Map(rows.map((row) => [row.id, row]));
}
