import { eq } from "drizzle-orm";
import { loadDotEnv, tenants } from "@provence360/database";
import { getAdminDb } from "@provence360/database/admin";

// These E2E tests run against the seeded dev database (`pnpm db:seed`),
// same convention as apps/web/e2e — see playwright.config.ts. Tenant/user
// ids are generated fresh on every seed run, so tests look them up by
// slug/email rather than hardcoding a UUID.
loadDotEnv();

// Matches packages/database/src/scripts/seed.ts. Public, seed-only — never
// a real credential (see docs/AUTHENTICATION.md#seed-data).
export const SEED_PASSWORD = "provence360-seed-only-not-a-real-password";

export const SEED_USERS = {
  alice: { email: "alice@provence-sud.test", tenantSlug: "provence-sud", role: "owner" },
  bob: { email: "bob@provence-sud.test", tenantSlug: "provence-sud", role: "member" },
  eve: { email: "eve@contractor.test", tenantSlug: "provence-sud", role: "admin" },
  carla: { email: "carla@luberon-retreats.test", tenantSlug: "luberon-retreats", role: "owner" },
  diego: { email: "diego@luberon-retreats.test", tenantSlug: "luberon-retreats", role: "member" },
} as const;

export async function tenantIdBySlug(slug: string): Promise<string> {
  const [row] = await getAdminDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug));
  if (!row) {
    throw new Error(
      `Tenant "${slug}" was not found — run \`pnpm db:seed\` against the dev database before running these E2E tests.`,
    );
  }
  return row.id;
}
