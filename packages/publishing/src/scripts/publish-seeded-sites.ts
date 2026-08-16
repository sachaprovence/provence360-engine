import { loadDotEnv, sites } from "@provence360/database";
import { closeAdminPool, getAdminDb } from "@provence360/database/admin";
import { closeAppPool } from "@provence360/database/client-app";
import { withTenantContext } from "@provence360/tenant";
import { publishSite } from "../publish";

// A separate step from `pnpm db:seed` on purpose: packages/database
// deliberately has no dependency on anything downstream of it (see
// packages/database/src/scripts/seed.ts's own docstring) — publishing
// requires `withTenantContext` (packages/tenant) and `publishSite`
// (packages/publishing), both of which depend ON packages/database, so a
// script that calls them can't live inside packages/database without
// creating a circular package dependency. This runs the REAL publish path
// (not a hand-rolled snapshot insert) precisely so the seeded sites'
// published Revisions are byte-for-byte what a real admin's "Publish"
// button would produce.
//
// Composed by the root `db:publish-seed` script, run right after
// `db:seed` — see package.json and .github/workflows/ci.yml.

loadDotEnv();

async function main(): Promise<void> {
  const db = getAdminDb();
  const rows = await db
    .select({ id: sites.id, tenantId: sites.tenantId, slug: sites.slug })
    .from(sites);

  for (const row of rows) {
    // Serial on purpose (no-await-in-loop isn't enabled in this repo's
    // eslint config anyway): publishing N seeded sites one at a time is
    // simpler to reason about than fanning out, and N is always small (a
    // handful of demo sites).
    await withTenantContext(row.tenantId, (tx) => publishSite(tx, { siteId: row.id }));
    console.log(`  published ${row.slug} (${row.id})`);
  }

  console.log(`Publish-seed complete: ${rows.length} site(s) published.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Two distinct connection pools are used here: the admin pool (listing
    // every site across tenants) and the app-role pool `withTenantContext`
    // opens internally for each `publishSite` call. Both must be closed —
    // an open `postgres` pool keeps Node's event loop alive indefinitely,
    // which is why this script (unlike seed.ts, which only ever touches
    // the admin pool) would otherwise hang after printing its own "done".
    await closeAdminPool();
    await closeAppPool();
  });
