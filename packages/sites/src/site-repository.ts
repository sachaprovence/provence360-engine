import { and, eq } from "drizzle-orm";
import type { AppTx, SiteStatus } from "@provence360/database";
import { sites } from "@provence360/database";
import { requireCurrentTenantId } from "@provence360/tenant";

/**
 * Creates a site owned by the current tenant. `tenantId` is always derived
 * from the active `withTenantContext()` call (never accepted as an
 * argument) so a caller cannot forge it — and even if this function had a
 * bug and forgot to set it correctly, the `tenant_isolation_sites` RLS
 * policy's `withCheck` clause would still reject a row whose `tenant_id`
 * doesn't match the transaction's `app.tenant_id`. Two independent layers,
 * either one alone would have stopped this.
 */
export async function createSite(
  tx: AppTx,
  input: { slug: string; name: string; status?: SiteStatus },
) {
  const tenantId = requireCurrentTenantId();

  const [row] = await tx
    .insert(sites)
    .values({
      tenantId,
      slug: input.slug,
      name: input.name,
      status: input.status ?? "draft",
    })
    .returning();
  if (!row) throw new Error("Failed to create site");
  return row;
}

export async function getSiteBySlug(tx: AppTx, slug: string) {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .select()
    .from(sites)
    .where(and(eq(sites.slug, slug), eq(sites.tenantId, tenantId)));
  return row ?? null;
}

export async function listSites(tx: AppTx) {
  const tenantId = requireCurrentTenantId();
  return tx.select().from(sites).where(eq(sites.tenantId, tenantId));
}
