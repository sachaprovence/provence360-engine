import { randomUUID } from "node:crypto";
import {
  domains,
  memberships,
  sites,
  tenants,
  users,
  type MembershipRole,
  type SiteStatus,
  type TenantStatus,
} from "@provence360/database";
import { getAdminDb } from "@provence360/database/admin";

// Fixture factories for tests. All writes go through the admin (RLS-
// bypassing) connection, on purpose: arranging test data is not a
// tenant-scoped operation, and forcing fixtures through withTenantContext()
// would make it impossible to construct the very cross-tenant scenarios the
// isolation tests need to set up.

function shortId(): string {
  return randomUUID().slice(0, 8);
}

export async function createTenant(
  overrides: {
    slug?: string;
    name?: string;
    status?: TenantStatus;
  } = {},
) {
  const db = getAdminDb();
  const [row] = await db
    .insert(tenants)
    .values({
      slug: overrides.slug ?? `tenant-${shortId()}`,
      name: overrides.name ?? "Test Tenant",
      status: overrides.status ?? "active",
    })
    .returning();
  if (!row) throw new Error("Failed to create test tenant");
  return row;
}

export async function createUser(overrides: { email?: string; name?: string } = {}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(users)
    .values({
      email: overrides.email ?? `user-${shortId()}@example.test`,
      name: overrides.name ?? "Test User",
    })
    .returning();
  if (!row) throw new Error("Failed to create test user");
  return row;
}

export async function createMembership(input: {
  tenantId: string;
  userId: string;
  role?: MembershipRole;
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(memberships)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role ?? "member",
    })
    .returning();
  if (!row) throw new Error("Failed to create test membership");
  return row;
}

export async function createSite(input: {
  tenantId: string;
  slug?: string;
  name?: string;
  status?: SiteStatus;
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(sites)
    .values({
      tenantId: input.tenantId,
      slug: input.slug ?? `site-${shortId()}`,
      name: input.name ?? "Test Site",
      status: input.status ?? "active",
    })
    .returning();
  if (!row) throw new Error("Failed to create test site");
  return row;
}

export async function createDomain(input: {
  tenantId: string;
  siteId: string;
  hostname?: string;
  isPrimary?: boolean;
  status?: "pending" | "active" | "disabled";
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(domains)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      hostname: input.hostname ?? `${shortId()}.test.example`,
      isPrimary: input.isPrimary ?? false,
      status: input.status ?? "active",
    })
    .returning();
  if (!row) throw new Error("Failed to create test domain");
  return row;
}
