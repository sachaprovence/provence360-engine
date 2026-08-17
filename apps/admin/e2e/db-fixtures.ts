import { and, eq } from "drizzle-orm";
import { loadDotEnv, pages, properties, sites, tenants, virtualTours } from "@provence360/database";
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

export async function siteIdBySlug(slug: string): Promise<string> {
  const [row] = await getAdminDb().select({ id: sites.id }).from(sites).where(eq(sites.slug, slug));
  if (!row) {
    throw new Error(`Site "${slug}" was not found — run \`pnpm db:seed\` first.`);
  }
  return row.id;
}

export async function propertyIdBySlug(slug: string): Promise<string> {
  const [row] = await getAdminDb()
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.slug, slug));
  if (!row) {
    throw new Error(`Property "${slug}" was not found — run \`pnpm db:seed\` first.`);
  }
  return row.id;
}

// v0.7.1 — the VirtualTours admin form (virtual-tours-form.tsx) never
// exposes a created tour's id in the DOM (only its name/provider/status),
// so an E2E test that needs to reference a just-created tour's id — to add
// a `virtual-tour` block pointing at it — has to look it up. Scoped by
// `publicName`, which every v0.7.1 spec below gives a unique-per-run value.
export async function virtualTourIdByPublicName(publicName: string): Promise<string> {
  const [row] = await getAdminDb()
    .select({ id: virtualTours.id })
    .from(virtualTours)
    .where(eq(virtualTours.publicName, publicName));
  if (!row) {
    throw new Error(`VirtualTour "${publicName}" was not found.`);
  }
  return row.id;
}

export async function homePageIdForSite(siteId: string): Promise<string> {
  // Filtered to the actual home page (slug === "", this codebase's own
  // convention — see docs/CONTENT_MODEL.md) rather than an unordered,
  // unfiltered `SELECT` — a shared fixture like "villas-cassis" can
  // legitimately accumulate several Pages across repeated E2E runs (some
  // specs deliberately create extra ones, e.g. site-editor.spec.ts's "OWNER
  // can create a new page"), and Postgres gives no ordering guarantee for a
  // query with neither an ORDER BY nor a unique filter — a previously
  // "usually works" assumption that a growing, real dev database can
  // eventually violate.
  const [row] = await getAdminDb()
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.siteId, siteId), eq(pages.slug, "")));
  if (!row) {
    throw new Error(`No home page found for site "${siteId}" — run \`pnpm db:seed\` first.`);
  }
  return row.id;
}
