import { and, eq } from "drizzle-orm";
import {
  memberships,
  tenants,
  type MembershipRole,
  type TenantStatus,
} from "@provence360/database";
import { getAuthDb } from "@provence360/database/client-auth";
import { uuidSchema } from "@provence360/validation";

// The authorization check itself, and the tenant switcher's data source.
// Both run *before* a tenant context exists — that's the whole reason
// `provence360_auth` gets its own narrow, read-only view of `memberships`
// and `tenants` (see packages/database/src/schema.ts). Neither function
// here ever writes anything; membership mutations go through
// membership-repository.ts, tenant-scoped, permission-checked.

export interface MembershipLookup {
  membershipId: string;
  role: MembershipRole;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: TenantStatus;
}

/**
 * Does `userId` have a membership in `tenantId`? Returns `null` if not (or
 * if the tenant is gone/suspended, or if `tenantId` isn't even a
 * well-formed UUID). That last case matters: this function is called
 * directly by page/layout code with a raw URL segment, not only through
 * `withAuthorizedTenantContext` (which already format-checks first) — a
 * malformed id must fail closed the same way an unknown one does (see
 * docs/SECURITY.md's Not-Found-over-Forbidden guidance), not bubble up as
 * a raw Postgres "invalid input syntax for type uuid" error.
 */
export async function getMembership(
  userId: string,
  tenantId: string,
): Promise<MembershipLookup | null> {
  if (!uuidSchema.safeParse(tenantId).success) return null;

  const [row] = await getAuthDb()
    .select({
      membershipId: memberships.id,
      role: memberships.role,
      tenantId: tenants.id,
      tenantSlug: tenants.slug,
      tenantName: tenants.name,
      tenantStatus: tenants.status,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)));

  if (!row || row.tenantStatus !== "active") return null;
  return row;
}

/** Every tenant `userId` belongs to — the tenant switcher's data source. */
export async function listMembershipsForUser(userId: string): Promise<MembershipLookup[]> {
  return getAuthDb()
    .select({
      membershipId: memberships.id,
      role: memberships.role,
      tenantId: tenants.id,
      tenantSlug: tenants.slug,
      tenantName: tenants.name,
      tenantStatus: tenants.status,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(tenants.status, "active")));
}
