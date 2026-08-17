import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AppTx } from "@provence360/database";
import { mediaAssets } from "@provence360/database";
import { requireCurrentTenantId } from "@provence360/tenant";
import { MediaAssetNotFoundError } from "./errors";

// v0.9 — Media Ingestion, Asset Lifecycle & Delivery Kernel (see
// docs/adr/0022-media-ingestion-asset-delivery.md). `packages/content`
// stays the owner of the MediaAsset entity itself (unchanged since v0.3 —
// ADR 0012) and gains only the new, additive columns v0.9's ingestion
// pipeline (`packages/media`) fills in once it has a real, validated
// file. Deliberately shape-level validation only here (never importing
// `packages/media`'s closed `IMAGE_VARIANT_TOKENS`/`mediaVariantsV1Schema`
// — that would create a `content -> media` dependency on top of `media ->
// content`'s existing one): `packages/media` is responsible for the
// *strict*, versioned validation of what it hands to `createMediaAsset`;
// this schema only guards the column shapes themselves against a
// programming error, the same depth `packages/sites`' `theme_overrides`
// column validates its own JSONB shape at.
const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be a lowercase hex-encoded SHA-256 digest");

const createMediaAssetInputSchema = z.object({
  kind: z.enum(["image", "video", "document"]),
  storageKey: z.string().min(1),
  mimeType: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  altText: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  checksumSha256: sha256HexSchema.optional(),
  byteSize: z.number().int().positive().optional(),
  variants: z.record(z.string(), z.unknown()).optional(),
  originalFilename: z.string().optional(),
});

export type CreateMediaAssetInput = z.infer<typeof createMediaAssetInputSchema>;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;

export async function createMediaAsset(tx: AppTx, rawInput: CreateMediaAssetInput) {
  const input = createMediaAssetInputSchema.parse(rawInput);
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .insert(mediaAssets)
    .values({
      tenantId,
      kind: input.kind,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      altText: input.altText,
      metadata: input.metadata ?? {},
      checksumSha256: input.checksumSha256,
      byteSize: input.byteSize,
      variants: input.variants ?? {},
      originalFilename: input.originalFilename,
    })
    .returning();
  if (!row) throw new Error("Failed to create media asset");
  return row;
}

/**
 * Updates only the intrinsic, global `altText` fallback on an existing
 * MediaAsset (brief §19) — never the binary content, never `storageKey`/
 * `checksumSha256`/`variants`. This is the one field the "new file = new
 * MediaAsset" binary-immutability rule (ADR 0022) deliberately does NOT
 * apply to: editorial metadata may keep evolving on the same row, since it
 * carries no bytes a published Revision's snapshot could silently drift
 * from (the snapshot freezes `altText` into the Revision's own
 * `MediaDescriptor` at publish time, same as any other descriptor field).
 */
export async function updateMediaAssetAltText(
  tx: AppTx,
  id: string,
  altText: string,
): Promise<MediaAssetRow> {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .update(mediaAssets)
    .set({ altText })
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.tenantId, tenantId)))
    .returning();
  if (!row) throw new MediaAssetNotFoundError(id);
  return row;
}

/**
 * A hard, irreversible row delete — pre-existing since v0.3, unchanged by
 * v0.9. Deliberately NOT exposed anywhere in the v0.9 Admin Media Library
 * (no "delete" button/action was added there — see ADR 0022, "deletion
 * policy"): this function neither deletes the underlying storage object
 * nor checks whether any Draft or already-published Revision still
 * references this id. Before v0.9, that was low-risk (MediaAsset was a
 * reference-only abstraction with no real byte-serving path). v0.9 changes
 * that: `resolveMediaDelivery` (`packages/media`) does a *live* row lookup
 * on every delivery request, including for an already-published Revision
 * (its frozen `MediaDescriptor` still carries the id, and the fingerprint
 * check needs the live `checksumSha256` to compare against) — so deleting
 * a row through this function can silently 404 an image a live Revision
 * still expects to render, violating the "don't break a historical/
 * published Revision" invariant (brief §27). Safe garbage collection
 * (reference counting across Drafts + every historical Revision, then
 * deleting both the row and the storage object together) is explicitly
 * deferred to a future mission; this function stays here only for
 * whatever pre-v0.9 caller already used it, not as a supported v0.9 flow.
 */
export async function deleteMediaAsset(tx: AppTx, id: string): Promise<void> {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .delete(mediaAssets)
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.tenantId, tenantId)))
    .returning();
  if (!row) throw new MediaAssetNotFoundError(id);
}

export async function getMediaAsset(tx: AppTx, id: string) {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.tenantId, tenantId)));
  return row ?? null;
}

/**
 * Lists every MediaAsset belonging to the current tenant — used by the
 * v0.8 admin Branding form's logo/favicon picker and (v0.9) the Media
 * Library grid. No pagination: this codebase's real-world media count per
 * tenant stays small in practice — the same scale assumption
 * `listThemes`/`listSites` already make. Newest first, so a freshly
 * uploaded asset is immediately visible at the top of the Media Library
 * without the admin having to scroll.
 */
export async function listMediaAssets(tx: AppTx) {
  const tenantId = requireCurrentTenantId();
  return tx
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.tenantId, tenantId))
    .orderBy(desc(mediaAssets.createdAt));
}

/**
 * Resolves a set of MediaAsset ids to the current tenant's rows only — a
 * stale or cross-tenant id (e.g. a block referencing another tenant's
 * media, whether by data corruption or a forged mutation) simply resolves
 * to nothing, the same "absent, not an error" contract as any other
 * tenant-scoped lookup (see docs/RENDERING.md). Callers (the renderer)
 * decide how to degrade when fewer rows come back than ids were asked for.
 */
export async function listMediaAssetsByIds(tx: AppTx, ids: readonly string[]) {
  const tenantId = requireCurrentTenantId();
  if (ids.length === 0) return [];
  return tx
    .select()
    .from(mediaAssets)
    .where(and(inArray(mediaAssets.id, [...ids]), eq(mediaAssets.tenantId, tenantId)));
}
