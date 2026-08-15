import { and, eq } from "drizzle-orm";
import type { AppTx, PageStatus, PageType } from "@provence360/database";
import { pages, sites } from "@provence360/database";
import { recordAuditLog } from "@provence360/observability";
import { requireCurrentTenantId } from "@provence360/tenant";
import "./blocks";
import { generateBlockInstanceId } from "./block-instance";
import {
  BlockNotFoundError,
  InvalidReorderError,
  PageNotFoundError,
  SiteNotFoundError,
} from "./errors";
import { parseBlockInstance, parsePageContentStrict, type ParsedBlock } from "./parse-block";
import { seoSchema, type Seo } from "./seo";

export interface CreatePageInput {
  siteId: string;
  slug: string;
  internalName: string;
  status?: PageStatus;
  pageType?: PageType;
  seo?: Seo;
  content?: unknown[];
  actorUserId?: string;
}

/**
 * Creates a Page owned by the current tenant, attached to a Site the
 * current tenant also owns (same site-ownership-check pattern as
 * `packages/domains`' `createDomain` and `packages/rentals`'
 * `createProperty`) — backstopped by `pages_tenant_site_fk` at the
 * database level. `content` is validated strictly (see `parsePageContentStrict`
 * in parse-block.ts) — a page can never be *created* holding an invalid
 * block, even though an already-stored one may later fail to render
 * gracefully if the registry changes underneath it.
 */
export async function createPage(tx: AppTx, input: CreatePageInput) {
  const tenantId = requireCurrentTenantId();

  const [site] = await tx
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, tenantId)));
  if (!site) throw new SiteNotFoundError(input.siteId);

  const seo = input.seo ? seoSchema.parse(input.seo) : {};
  const content = parsePageContentStrict(input.content ?? []);

  const [row] = await tx
    .insert(pages)
    .values({
      tenantId,
      siteId: site.id,
      slug: input.slug,
      internalName: input.internalName,
      status: input.status ?? "draft",
      pageType: input.pageType ?? "standard",
      seo,
      content,
    })
    .returning();
  if (!row) throw new Error("Failed to create page");

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "PAGE_CREATED",
    targetType: "page",
    targetId: row.id,
    metadata: { slug: row.slug, siteId: row.siteId },
  });

  return row;
}

export interface UpdatePageMetaInput {
  id: string;
  internalName?: string;
  status?: PageStatus;
  seo?: Seo;
  actorUserId?: string;
}

/** Updates a Page's metadata (never its `content` — see `addBlock`/`updateBlockProps`/`removeBlock`/`reorderBlocks`). */
export async function updatePageMeta(tx: AppTx, input: UpdatePageMetaInput) {
  const tenantId = requireCurrentTenantId();
  const { id, actorUserId, seo, ...rest } = input;

  const [row] = await tx
    .update(pages)
    .set({
      ...rest,
      ...(seo !== undefined ? { seo: seoSchema.parse(seo) } : {}),
    })
    .where(and(eq(pages.id, id), eq(pages.tenantId, tenantId)))
    .returning();
  if (!row) throw new PageNotFoundError(id);

  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: "PAGE_UPDATED",
    targetType: "page",
    targetId: row.id,
    metadata: { slug: row.slug },
  });

  return row;
}

export async function deletePage(tx: AppTx, id: string, actorUserId?: string): Promise<void> {
  const tenantId = requireCurrentTenantId();

  const [row] = await tx
    .delete(pages)
    .where(and(eq(pages.id, id), eq(pages.tenantId, tenantId)))
    .returning();
  if (!row) throw new PageNotFoundError(id);

  await recordAuditLog(tx, {
    ...(actorUserId ? { actorUserId } : {}),
    action: "PAGE_DELETED",
    targetType: "page",
    targetId: row.id,
    metadata: { slug: row.slug },
  });
}

export async function getPage(tx: AppTx, id: string) {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.id, id), eq(pages.tenantId, tenantId)));
  return row ?? null;
}

export async function getPageBySlug(tx: AppTx, siteId: string, slug: string) {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.siteId, siteId), eq(pages.slug, slug), eq(pages.tenantId, tenantId)));
  return row ?? null;
}

export async function listPagesForSite(tx: AppTx, siteId: string) {
  const tenantId = requireCurrentTenantId();
  return tx
    .select()
    .from(pages)
    .where(and(eq(pages.siteId, siteId), eq(pages.tenantId, tenantId)));
}

// --- Block mutations -------------------------------------------------------
// `content` is a JSONB array (see docs/adr/0013-page-content-storage.md),
// so every mutation is read-modify-write: load the page, transform the
// validated array, write the whole array back in one UPDATE. Each helper
// re-validates the *entire* resulting array before writing — a bug in one
// helper can never leave `pages.content` holding something
// `parsePageContentStrict` couldn't parse back out.

async function loadPageForMutation(tx: AppTx, pageId: string, tenantId: string) {
  const [row] = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.tenantId, tenantId)));
  if (!row) throw new PageNotFoundError(pageId);
  return row;
}

export interface AddBlockInput {
  pageId: string;
  type: string;
  version: number;
  props: unknown;
  actorUserId?: string;
}

/** Appends a new block instance (a fresh, stable id — section 18) to the end of the page's content. */
export async function addBlock(tx: AppTx, input: AddBlockInput): Promise<ParsedBlock> {
  const tenantId = requireCurrentTenantId();
  const page = await loadPageForMutation(tx, input.pageId, tenantId);

  const instance = {
    id: generateBlockInstanceId(),
    type: input.type,
    version: input.version,
    props: input.props,
  };
  const parsed = parseBlockInstance(instance); // validates before it ever touches the array

  const nextContent = [...(page.content as unknown[]), instance];
  parsePageContentStrict(nextContent); // re-validate the whole array, defense in depth

  await tx.update(pages).set({ content: nextContent }).where(eq(pages.id, page.id));

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "PAGE_BLOCK_ADDED",
    targetType: "page",
    targetId: page.id,
    metadata: { blockId: instance.id, type: input.type },
  });

  return parsed;
}

export interface UpdateBlockPropsInput {
  pageId: string;
  blockId: string;
  props: unknown;
  actorUserId?: string;
}

/** Replaces one block instance's `props` in place — `id`/`type`/`version` are unchanged. */
export async function updateBlockProps(
  tx: AppTx,
  input: UpdateBlockPropsInput,
): Promise<ParsedBlock> {
  const tenantId = requireCurrentTenantId();
  const page = await loadPageForMutation(tx, input.pageId, tenantId);
  const content = page.content as Array<{
    id: string;
    type: string;
    version: number;
    props: unknown;
  }>;

  const existing = content.find((b) => b.id === input.blockId);
  if (!existing) throw new BlockNotFoundError(input.blockId, input.pageId);

  const updatedInstance = { ...existing, props: input.props };
  const parsed = parseBlockInstance(updatedInstance);

  const nextContent = content.map((b) => (b.id === input.blockId ? updatedInstance : b));
  parsePageContentStrict(nextContent);

  await tx.update(pages).set({ content: nextContent }).where(eq(pages.id, page.id));

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "PAGE_BLOCK_UPDATED",
    targetType: "page",
    targetId: page.id,
    metadata: { blockId: input.blockId, type: existing.type },
  });

  return parsed;
}

export interface RemoveBlockInput {
  pageId: string;
  blockId: string;
  actorUserId?: string;
}

export async function removeBlock(tx: AppTx, input: RemoveBlockInput): Promise<void> {
  const tenantId = requireCurrentTenantId();
  const page = await loadPageForMutation(tx, input.pageId, tenantId);
  const content = page.content as Array<{ id: string; type: string }>;

  const existing = content.find((b) => b.id === input.blockId);
  if (!existing) throw new BlockNotFoundError(input.blockId, input.pageId);

  const nextContent = content.filter((b) => b.id !== input.blockId);

  await tx.update(pages).set({ content: nextContent }).where(eq(pages.id, page.id));

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "PAGE_BLOCK_REMOVED",
    targetType: "page",
    targetId: page.id,
    metadata: { blockId: input.blockId, type: existing.type },
  });
}

export interface ReorderBlocksInput {
  pageId: string;
  orderedBlockIds: readonly string[];
  actorUserId?: string;
}

/**
 * Reorders the page's blocks to exactly `orderedBlockIds` — which must be
 * a permutation of the page's current block ids (same set, same length).
 * Rejects a partial list (would silently drop blocks) or an unknown id
 * (would silently no-op it) rather than guessing the caller's intent.
 */
export async function reorderBlocks(tx: AppTx, input: ReorderBlocksInput): Promise<void> {
  const tenantId = requireCurrentTenantId();
  const page = await loadPageForMutation(tx, input.pageId, tenantId);
  const content = page.content as Array<{
    id: string;
    type: string;
    version: number;
    props: unknown;
  }>;

  const currentIds = new Set(content.map((b) => b.id));
  const requestedIds = new Set(input.orderedBlockIds);
  if (
    currentIds.size !== requestedIds.size ||
    ![...currentIds].every((id) => requestedIds.has(id))
  ) {
    throw new InvalidReorderError(
      "orderedBlockIds must contain exactly the page's current block ids, each exactly once",
    );
  }

  const byId = new Map(content.map((b) => [b.id, b]));
  const nextContent = input.orderedBlockIds.map((id) => {
    const block = byId.get(id);
    // Unreachable: the set-equality check above already guarantees every
    // id in orderedBlockIds is a key of byId. Guarded explicitly anyway
    // rather than with a non-null assertion, so a future refactor that
    // breaks that guarantee fails loudly instead of silently.
    if (!block) throw new InvalidReorderError(`internal: block "${id}" vanished mid-reorder`);
    return block;
  });

  await tx.update(pages).set({ content: nextContent }).where(eq(pages.id, page.id));

  await recordAuditLog(tx, {
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "PAGE_BLOCK_REORDERED",
    targetType: "page",
    targetId: page.id,
    metadata: { order: input.orderedBlockIds },
  });
}
