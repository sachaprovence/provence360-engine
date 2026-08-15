"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSite } from "@provence360/sites";
import { withTenantPage } from "@/lib/actor";

const createSiteSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits, hyphens only"),
  name: z.string().trim().min(1).max(200),
});

export interface CreateSiteState {
  error?: string;
}

export async function createSiteAction(
  tenantId: string,
  _prevState: CreateSiteState,
  formData: FormData,
): Promise<CreateSiteState> {
  const parsed = createSiteSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await withTenantPage(tenantId, "site.create", (tx, actor) =>
      createSite(tx, { ...parsed.data, actorUserId: actor.userId }),
    );
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return { error: "A site with that slug already exists." };
    }
    throw error;
  }

  revalidatePath(`/admin/tenants/${tenantId}/sites`);
  return {};
}
