import { and, eq } from "drizzle-orm";
import { domains, sites, type SiteStatus } from "@provence360/database";
import { getResolverDb } from "@provence360/database/client-resolver";
import { normalizeHostname } from "@provence360/validation";

export interface ResolvedSite {
  siteId: string;
  tenantId: string;
  siteStatus: SiteStatus;
}

/**
 * The Host -> DomainResolver -> Site -> Tenant step of the public request
 * pipeline. Runs before any tenant is known, so it deliberately does NOT go
 * through `withTenantContext()` — it uses the narrow, column-restricted
 * `provence360_resolver` role instead (see docs/SECURITY.md). Callers
 * (apps/web) are responsible for deciding what to do with a non-"active"
 * `siteStatus` (e.g. render a "site suspended" page) — this function's only
 * job is the hostname -> site/tenant mapping itself.
 *
 * Fails closed and fails clean: a malformed or unknown hostname returns
 * `null`, never throws into the request path.
 */
export async function resolveSiteByHostname(rawHostname: string): Promise<ResolvedSite | null> {
  let hostname: string;
  try {
    hostname = normalizeHostname(rawHostname);
  } catch {
    return null;
  }

  const db = getResolverDb();
  const [row] = await db
    .select({
      siteId: sites.id,
      tenantId: sites.tenantId,
      siteStatus: sites.status,
    })
    .from(domains)
    .innerJoin(sites, eq(domains.siteId, sites.id))
    .where(and(eq(domains.hostname, hostname), eq(domains.status, "active")))
    .limit(1);

  return row ?? null;
}
