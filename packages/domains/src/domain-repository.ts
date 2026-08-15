import { and, eq } from "drizzle-orm";
import type { AppTx, DomainStatus } from "@provence360/database";
import { domains, sites } from "@provence360/database";
import { requireCurrentTenantId } from "@provence360/tenant";
import { normalizeHostname } from "@provence360/validation";

export class SiteNotFoundError extends Error {
  constructor(siteId: string) {
    super(`Site "${siteId}" was not found (or does not belong to the current tenant).`);
    this.name = "SiteNotFoundError";
  }
}

/**
 * Attaches a hostname to a site owned by the current tenant.
 *
 * `tenantId` is never accepted as a parameter — it is always derived from
 * the active `withTenantContext()` call, so a caller cannot accidentally
 * (or maliciously) create a domain under the wrong tenant. The target site
 * is looked up through the *same* tenant-scoped transaction first, which
 * means an attempt to attach a domain to another tenant's site simply finds
 * nothing (RLS already filtered it out) and fails with `SiteNotFoundError`
 * — the same defense-in-depth pattern as everywhere else in this codebase.
 */
export async function createDomain(
  tx: AppTx,
  input: { siteId: string; hostname: string; isPrimary?: boolean; status?: DomainStatus },
) {
  const tenantId = requireCurrentTenantId();

  const [site] = await tx
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, tenantId)));
  if (!site) throw new SiteNotFoundError(input.siteId);

  const hostname = normalizeHostname(input.hostname);

  const [row] = await tx
    .insert(domains)
    .values({
      tenantId,
      siteId: site.id,
      hostname,
      isPrimary: input.isPrimary ?? false,
      status: input.status ?? "pending",
    })
    .returning();
  if (!row) throw new Error("Failed to create domain");
  return row;
}

export async function listDomainsForSite(tx: AppTx, siteId: string) {
  const tenantId = requireCurrentTenantId();
  return tx
    .select()
    .from(domains)
    .where(and(eq(domains.siteId, siteId), eq(domains.tenantId, tenantId)));
}
