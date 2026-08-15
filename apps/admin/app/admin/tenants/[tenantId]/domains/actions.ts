"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDomain } from "@provence360/domains";
import { uuidSchema } from "@provence360/validation";
import { withTenantPage } from "@/lib/actor";

const createDomainSchema = z.object({
  siteId: uuidSchema,
  hostname: z.string().trim().min(1).max(253),
});

export interface CreateDomainState {
  error?: string;
}

export async function createDomainAction(
  tenantId: string,
  _prevState: CreateDomainState,
  formData: FormData,
): Promise<CreateDomainState> {
  const parsed = createDomainSchema.safeParse({
    siteId: formData.get("siteId"),
    hostname: formData.get("hostname"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await withTenantPage(tenantId, "domain.create", (tx, actor) =>
      createDomain(tx, { ...parsed.data, actorUserId: actor.userId }),
    );
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return { error: "That hostname is already in use." };
    }
    throw error;
  }

  revalidatePath(`/admin/tenants/${tenantId}/domains`);
  return {};
}
