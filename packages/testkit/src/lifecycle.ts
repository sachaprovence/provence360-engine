import { sql } from "drizzle-orm";
import {
  loadDotEnv,
  amenities,
  auditLogs,
  domains,
  mediaAssets,
  memberships,
  pages,
  properties,
  propertyAmenities,
  siteRevisions,
  sitePublications,
  sites,
  tenants,
  themes,
  unitAmenities,
  units,
  unitSleepingArrangements,
  users,
} from "@provence360/database";
import { getAdminDb } from "@provence360/database/admin";

// Vitest sets NODE_ENV=test by default; loadDotEnv() reads that to pick
// .env.test over .env. We assert it explicitly anyway — a testkit helper
// that silently ran against whatever DATABASE_URL happens to be in scope
// would be exactly the kind of footgun this project's security posture is
// trying to eliminate everywhere else.
function assertTestEnvironment(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "@provence360/testkit must only run with NODE_ENV=test — refusing to touch a non-test database.",
    );
  }
}

let readyPromise: Promise<void> | undefined;

/**
 * Confirms the test database is migrated and its roles are set up. Does
 * NOT run migrations itself: `turbo run test` fans out to many packages'
 * `vitest run` as separate OS processes, all pointed at the same test
 * database — if each one tried to migrate/grant on first use, they'd race
 * each other issuing concurrent DDL against the same schema (this used to
 * happen: "duplicate key value violates unique constraint
 * pg_type_typname_nsp_index", "tuple concurrently updated"). Instead, the
 * root `test:db:prepare` script runs once, serially, before `turbo run
 * test` even starts (see turbo.json's `test` task `dependsOn`). This
 * function just fails fast with a clear message if that didn't happen.
 */
export function ensureTestDatabaseReady(): Promise<void> {
  assertTestEnvironment();
  readyPromise ??= (async () => {
    loadDotEnv();
    const db = getAdminDb();
    try {
      await db.select().from(tenants).limit(1);
    } catch (cause) {
      throw new Error(
        "Test database isn't migrated yet. Run `pnpm test:db:prepare` (or `pnpm test` from " +
          "the repo root, which does this for you) before running a package's tests directly.",
        { cause },
      );
    }
  })();
  return readyPromise;
}

/**
 * Wipes all tenant-scoped data via the admin (RLS-bypassing) connection.
 * Call this in `beforeEach` for tests that need a clean slate.
 *
 * `amenities`/`themes` are platform-level catalogs, not tenant data (see
 * docs/adr/0012-media-asset-and-amenity-catalog.md) — on the real
 * dev/prod database they're deliberately long-lived, curated rows. In the
 * test database they're just as ephemeral as everything else: every test
 * that needs one creates its own via `createAmenity`/`createTheme`, so
 * truncating them here between tests is what keeps the catalog from
 * accumulating one-off rows across an entire test run.
 */
export async function resetDatabase(): Promise<void> {
  assertTestEnvironment();
  const db = getAdminDb();
  await db.execute(
    sql`truncate table ${auditLogs}, ${sitePublications}, ${siteRevisions}, ${unitSleepingArrangements}, ${propertyAmenities}, ${unitAmenities}, ${units}, ${properties}, ${pages}, ${mediaAssets}, ${domains}, ${sites}, ${memberships}, ${tenants}, ${users}, ${amenities}, ${themes} restart identity cascade`,
  );
}
