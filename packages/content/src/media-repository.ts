import { and, eq, inArray } from "drizzle-orm";
import type { AppTx, MediaKind } from "@provence360/database";
import { mediaAssets } from "@provence360/database";
import { requireCurrentTenantId } from "@provence360/tenant";
import { MediaAssetNotFoundError } from "./errors";

export interface CreateMediaAssetInput {
  kind: MediaKind;
  storageKey: string;
  mimeType: string;
  width?: number;
  height?: number;
  altText?: string;
  metadata?: Record<string, unknown>;
}

export async function createMediaAsset(tx: AppTx, input: CreateMediaAssetInput) {
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
    })
    .returning();
  if (!row) throw new Error("Failed to create media asset");
  return row;
}

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
