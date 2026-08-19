import { hash as argon2Hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { closeAdminPool, getAdminDb } from "../admin/index";
import { parseBootstrapInput } from "../bootstrap-input";
import { loadDotEnv } from "../load-env";
import { domains, memberships, sites, tenants, users } from "../schema";

// v1.0.2 — brief SUJET H: `pnpm db:seed` is a dev/test *fixture* script,
// permanently blocked from production by `assertSeedSafeTarget()` (see
// seed-safety.ts) — and rightly so, its data (canned tenants, a published
// shared seed password) must never exist in a real deployment. But that
// left a real gap this release closes: a brand-new production database has
// no self-service way to create its first real owner/tenant/site, because
// apps/admin has no signup flow (login only — see docs/AUTHENTICATION.md).
// This script is the minimal, explicit, one-shot answer: an operator-driven
// CLI, never invoked automatically by any app process, that creates exactly
// one operator-specified owner + tenant + site + initial domain, then exits.
//
// Deliberately NOT gated by `assertSeedSafeTarget()` — that guard exists to
// keep dev/test *fixtures* out of production; this script is the opposite,
// a real-data production provisioning tool, and gating it the same way
// would defeat its entire purpose. Its own safety comes from three
// independent properties instead:
//   1. every value (email/password/tenant/site/domain) is operator-supplied
//      via required environment variables — there is no default value for
//      anything, least of all the owner password.
//   2. idempotent by tenant slug: if BOOTSTRAP_TENANT_SLUG already exists,
//      this exits 0 having changed nothing (not a duplicate-tenant crash,
//      not a silent overwrite) — safe to re-run after a failed/partial
//      attempt, or to invoke again later for a second tenant with a
//      different slug.
//   3. the owner password is never logged, anywhere, including on failure.
//
// Usage (see docs/RAILWAY.md, "Bootstrap the first tenant" for the full
// Railway-specific walkthrough):
//   BOOTSTRAP_OWNER_EMAIL=owner@example.com \
//   BOOTSTRAP_OWNER_NAME="Jane Owner" \
//   BOOTSTRAP_OWNER_PASSWORD="<a real, unique, operator-chosen password>" \
//   BOOTSTRAP_TENANT_SLUG=my-tenant \
//   BOOTSTRAP_TENANT_NAME="My Tenant" \
//   BOOTSTRAP_SITE_SLUG=my-site \
//   BOOTSTRAP_SITE_NAME="My Site" \
//   BOOTSTRAP_DOMAIN_HOSTNAME=my-app.up.railway.app \
//   pnpm db:bootstrap-production
//
// There is still no self-service password-reset flow (a known, documented
// gap — see docs/AUTHENTICATION.md#passwords): the password given here is
// the only one that will ever work for this owner until an operator with
// direct database access clears `password_hash` by hand. Choose it
// accordingly and store it in a real secret manager, not in a chat log or a
// shell history file.

// Mirrors packages/auth/src/password.ts's ARGON2_OPTIONS — duplicated
// rather than imported for the same reason packages/database/src/scripts/
// seed.ts already duplicates it: packages/auth depends on
// packages/database, so the reverse import would be circular.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

async function main(): Promise<void> {
  const input = parseBootstrapInput();
  const db = getAdminDb();

  const [existingTenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, input.tenantSlug));
  if (existingTenant) {
    console.log(
      `Bootstrap already performed for tenant slug "${input.tenantSlug}" (tenant ${existingTenant.id}) — nothing to do.`,
    );
    return;
  }

  const ownerPasswordHash = await argon2Hash(input.ownerPassword, ARGON2_OPTIONS);

  const [tenant] = await db
    .insert(tenants)
    .values({ slug: input.tenantSlug, name: input.tenantName, status: "active" })
    .returning();
  if (!tenant) throw new Error("Failed to create tenant");

  const [owner] = await db
    .insert(users)
    .values({ email: input.ownerEmail, name: input.ownerName, passwordHash: ownerPasswordHash })
    .returning();
  if (!owner) throw new Error("Failed to create owner user");

  await db.insert(memberships).values({ tenantId: tenant.id, userId: owner.id, role: "owner" });

  const [site] = await db
    .insert(sites)
    .values({ tenantId: tenant.id, slug: input.siteSlug, name: input.siteName, status: "active" })
    .returning();
  if (!site) throw new Error("Failed to create site");

  const [domain] = await db
    .insert(domains)
    .values({
      tenantId: tenant.id,
      siteId: site.id,
      hostname: input.domainHostname,
      isPrimary: true,
      status: "active",
    })
    .returning();
  if (!domain) throw new Error("Failed to create domain");

  console.log("Bootstrap complete:");
  console.log(`  tenant: ${input.tenantSlug} (${tenant.id})`);
  console.log(`  owner:  ${input.ownerEmail} (${owner.id}) — role: owner`);
  console.log(
    `  site:   ${input.siteSlug} (${site.id}) — status: active, no published revision yet`,
  );
  console.log(`  domain: ${input.domainHostname} (${domain.id}) — status: active`);
  console.log(
    "  Log in to apps/admin with the email/password you provided, then create a Page and publish it.",
  );
}

loadDotEnv();

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeAdminPool();
  });
