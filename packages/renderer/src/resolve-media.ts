import { listMediaAssetsByIds } from "@provence360/content";
import type { FrozenMediaDescriptor, FrozenMediaVariants, RenderContext } from "./render-context";

/**
 * `media_assets.variants` is stored as `{version: 1, thumbnail?: {...},
 * ...}` (or `{}`) — see `packages/publishing/src/media-manifest.ts`'s own
 * identical helper for the frozen-manifest path. This is the live-lookup
 * counterpart: strips the version wrapper so both paths hand a block the
 * exact same `FrozenMediaVariants` shape regardless of whether it came
 * from a frozen Revision or a live Draft-preview lookup.
 */
function toFrozenVariants(raw: unknown): FrozenMediaVariants | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { version: _version, ...rest } = raw as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

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
  if (!row) return null;
  return {
    id: row.id,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    altText: row.altText,
    checksumSha256: row.checksumSha256,
    byteSize: row.byteSize,
    variants: toFrozenVariants(row.variants),
  };
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
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        storageKey: row.storageKey,
        mimeType: row.mimeType,
        width: row.width,
        height: row.height,
        altText: row.altText,
        checksumSha256: row.checksumSha256,
        byteSize: row.byteSize,
        variants: toFrozenVariants(row.variants),
      },
    ]),
  );
}
