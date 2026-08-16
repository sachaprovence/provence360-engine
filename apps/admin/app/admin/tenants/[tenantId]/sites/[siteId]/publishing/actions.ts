"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rollbackSite, publishSite } from "@provence360/publishing";
import { uuidSchema } from "@provence360/validation";
import { withTenantPage } from "@/lib/actor";

export interface PublishingActionState {
  error?: string;
}

export async function publishSiteAction(
  tenantId: string,
  siteId: string,
  _prevState: PublishingActionState,
  _formData: FormData,
): Promise<PublishingActionState> {
  try {
    await withTenantPage(tenantId, "release.publish", (tx, actor) =>
      publishSite(tx, { siteId, actorUserId: actor.userId }),
    );
  } catch (error) {
    return { error: friendlyMessage(error) };
  }

  revalidatePath(`/admin/tenants/${tenantId}/sites/${siteId}/publishing`);
  revalidatePath(`/admin/tenants/${tenantId}/sites/${siteId}`);
  return {};
}

const rollbackSchema = z.object({ targetRevisionId: uuidSchema });

export async function rollbackSiteAction(
  tenantId: string,
  siteId: string,
  _prevState: PublishingActionState,
  formData: FormData,
): Promise<PublishingActionState> {
  const parsed = rollbackSchema.safeParse({ targetRevisionId: formData.get("targetRevisionId") });
  if (!parsed.success) return { error: "Invalid revision." };

  try {
    await withTenantPage(tenantId, "release.publish", (tx, actor) =>
      rollbackSite(tx, {
        siteId,
        targetRevisionId: parsed.data.targetRevisionId,
        actorUserId: actor.userId,
      }),
    );
  } catch (error) {
    return { error: friendlyMessage(error) };
  }

  revalidatePath(`/admin/tenants/${tenantId}/sites/${siteId}/publishing`);
  revalidatePath(`/admin/tenants/${tenantId}/sites/${siteId}`);
  return {};
}

function friendlyMessage(error: unknown): string {
  if (
    error instanceof Error &&
    /SiteNotFoundError|RevisionNotFoundError|PublishValidationError/.test(error.name)
  ) {
    return error.message;
  }
  throw error;
}
