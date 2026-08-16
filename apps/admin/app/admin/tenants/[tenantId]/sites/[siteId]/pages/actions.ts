"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addBlock,
  createPage,
  deletePage,
  removeBlock,
  reorderBlocks,
  updateBlockProps,
  updatePageMeta,
} from "@provence360/content";
import { toSlug } from "@provence360/validation";
import { withTenantPage } from "@/lib/actor";

export interface FormActionState {
  error?: string;
}

function basePath(tenantId: string, siteId: string): string {
  return `/admin/tenants/${tenantId}/sites/${siteId}/pages`;
}

const createPageSchema = z.object({
  internalName: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(200),
  pageType: z.enum(["home", "standard", "property", "unit", "contact"]),
});

export async function createPageAction(
  tenantId: string,
  siteId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = createPageSchema.safeParse({
    internalName: formData.get("internalName"),
    slug: formData.get("slug"),
    pageType: formData.get("pageType"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  let slug: string;
  try {
    // A "home" page conventionally has an empty slug (site root, "/") —
    // never run through toSlug, which rejects an empty string outright.
    slug = parsed.data.pageType === "home" ? "" : toSlug(parsed.data.slug);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid slug." };
  }

  try {
    await withTenantPage(tenantId, "page.create", (tx, actor) =>
      createPage(tx, {
        siteId,
        slug,
        internalName: parsed.data.internalName,
        pageType: parsed.data.pageType,
        actorUserId: actor.userId,
      }),
    );
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return { error: "A page with that slug already exists on this site." };
    }
    if (error instanceof Error && error.name === "SiteNotFoundError")
      return { error: "Site not found." };
    throw error;
  }

  revalidatePath(basePath(tenantId, siteId));
  return {};
}

const updateMetaSchema = z.object({
  internalName: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

export async function updatePageMetaAction(
  tenantId: string,
  siteId: string,
  pageId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = updateMetaSchema.safeParse({
    internalName: formData.get("internalName")?.toString() || undefined,
    status: formData.get("status")?.toString() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withTenantPage(tenantId, "page.update", (tx, actor) =>
      updatePageMeta(tx, {
        id: pageId,
        ...(parsed.data.internalName !== undefined
          ? { internalName: parsed.data.internalName }
          : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        actorUserId: actor.userId,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "PageNotFoundError")
      return { error: "Page not found." };
    throw error;
  }

  revalidatePath(`${basePath(tenantId, siteId)}/${pageId}`);
  return {};
}

export async function deletePageAction(
  tenantId: string,
  siteId: string,
  pageId: string,
): Promise<void> {
  await withTenantPage(tenantId, "page.delete", (tx, actor) =>
    deletePage(tx, pageId, actor.userId),
  );
  revalidatePath(basePath(tenantId, siteId));
}

const addBlockSchema = z.object({
  type: z.string().trim().min(1),
  version: z.coerce.number().int().positive(),
  props: z.string(),
});

export async function addBlockAction(
  tenantId: string,
  siteId: string,
  pageId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = addBlockSchema.safeParse({
    type: formData.get("type"),
    version: formData.get("version"),
    props: formData.get("props"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  let props: unknown;
  try {
    props = JSON.parse(parsed.data.props || "{}");
  } catch {
    return { error: "Props must be valid JSON." };
  }

  try {
    await withTenantPage(tenantId, "page.update", (tx, actor) =>
      addBlock(tx, {
        pageId,
        type: parsed.data.type,
        version: parsed.data.version,
        props,
        actorUserId: actor.userId,
      }),
    );
  } catch (error) {
    if (error instanceof Error) return { error: error.message };
    throw error;
  }

  revalidatePath(`${basePath(tenantId, siteId)}/${pageId}`);
  return {};
}

export async function updateBlockPropsAction(
  tenantId: string,
  siteId: string,
  pageId: string,
  blockId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const raw = formData.get("props")?.toString() ?? "";
  let props: unknown;
  try {
    props = JSON.parse(raw);
  } catch {
    return { error: "Props must be valid JSON." };
  }

  try {
    await withTenantPage(tenantId, "page.update", (tx, actor) =>
      updateBlockProps(tx, { pageId, blockId, props, actorUserId: actor.userId }),
    );
  } catch (error) {
    if (error instanceof Error) return { error: error.message };
    throw error;
  }

  revalidatePath(`${basePath(tenantId, siteId)}/${pageId}`);
  return {};
}

export async function removeBlockAction(
  tenantId: string,
  siteId: string,
  pageId: string,
  blockId: string,
): Promise<void> {
  await withTenantPage(tenantId, "page.update", (tx, actor) =>
    removeBlock(tx, { pageId, blockId, actorUserId: actor.userId }),
  );
  revalidatePath(`${basePath(tenantId, siteId)}/${pageId}`);
}

export async function reorderBlocksAction(
  tenantId: string,
  siteId: string,
  pageId: string,
  orderedBlockIds: readonly string[],
): Promise<void> {
  await withTenantPage(tenantId, "page.update", (tx, actor) =>
    reorderBlocks(tx, { pageId, orderedBlockIds, actorUserId: actor.userId }),
  );
  revalidatePath(`${basePath(tenantId, siteId)}/${pageId}`);
}
