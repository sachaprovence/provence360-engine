// v1.0.1 — brief SUJET C: a central, fail-closed guard for every script
// that writes non-production fixture/demo data — today `db:seed`
// (`src/scripts/seed.ts`) and `db:publish-seed`
// (`packages/publishing/src/scripts/publish-seeded-sites.ts`), and any
// future script in the same category. Deliberately NOT applied to
// `db:migrate`/`db:setup-roles` (`admin/migrate.ts`, `admin/setup-roles.ts`)
// — production must still be able to run those; see docs/DEPLOYMENT.md,
// "Migrations".
//
// `NODE_ENV=production` alone can't be trusted as the sole signal — this
// codebase already has one legitimate case elsewhere where
// `NODE_ENV=production` does NOT mean "a real deployment" (the admin/web
// Playwright E2E `webServer` configs; see `MEDIA_ALLOW_MEMORY_IN_PRODUCTION`
// in `packages/validation/src/env.ts`). The inverse is just as real a risk
// in the other direction: `NODE_ENV` can be "development" or unset while
// `DATABASE_URL` genuinely points at a real, shared, non-development
// database (a misconfigured `.env`, a copy-pasted connection string, a
// personal machine accidentally still pointed at a shared credential). So
// this checks the actual TARGET the command is about to write to, not just
// the process's own declared environment — and refuses unless it can
// positively confirm the target is safe, rather than only refusing a
// blocklist of known-bad values.
//
// `NODE_ENV=production` is refused unconditionally — no override exists
// for it, matching the runbook (docs/DEPLOYMENT.md, "Migrations":
// production runs `db:migrate` + `db:setup-roles`, never seed). Everything
// else must show at least one of two independent positive signals:
//   - CI environment detected (`CI=true`/`CI=1`, the standard signal every
//     GitHub Actions job already runs under, set automatically — see
//     .github/workflows/ci.yml);
//   - the target database's own name matches this repo's own dev/test
//     naming convention (`provence360_dev`/`provence360_test`, or any name
//     ending in `_dev`/`_test` — see docker-compose.yml and
//     docker/postgres-init/01-create-test-db.sql).
// Neither present -> refused. This is the "ambiguous target" case: a
// database this guard cannot positively vouch for is treated the same as a
// production one, never assumed safe by default. No separate escape-hatch
// env var exists here — CI detection plus the naming convention already
// cover every legitimate case this repo's own tooling produces (local dev,
// `pnpm test:db:prepare`, and CI all use a `_dev`/`_test`-suffixed database
// and/or run under CI=true), so adding one would only be a bypass looking
// for a use.

export interface SeedSafetyEnv {
  NODE_ENV?: string;
  CI?: string;
  DATABASE_URL?: string;
}

const DEV_OR_TEST_DB_NAME = /(^|_)(dev|test)$/i;

function extractDatabaseName(databaseUrl: string): string {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function isCiEnvironment(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/**
 * Throws with a clear, actionable message if the current environment
 * cannot be confidently established as a dev/test/CI target. Never writes
 * anything itself, never logs a connection string or credential — callers
 * must call this before their first write, so a refusal here guarantees
 * zero rows were touched.
 */
export function assertSeedSafeTarget(source: NodeJS.ProcessEnv = process.env): void {
  const env = source as SeedSafetyEnv;

  if (env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed database: NODE_ENV=production. Seed/demo data must never be written to " +
        'a production database — see docs/DEPLOYMENT.md, "Migrations". There is no override for ' +
        "this check.",
    );
  }

  const dbName = extractDatabaseName(env.DATABASE_URL ?? "");
  const isCi = isCiEnvironment(env.CI);
  const isKnownDevOrTestName = DEV_OR_TEST_DB_NAME.test(dbName);

  if (isCi || isKnownDevOrTestName) return;

  throw new Error(
    "Refusing to seed database: target is not explicitly marked as seed-safe " +
      `(database "${dbName || "<unparseable DATABASE_URL>"}" does not match the dev/test naming ` +
      'convention — a name ending in "_dev" or "_test" — and CI was not detected). If this is ' +
      'genuinely a dev/test database, name it accordingly. See docs/DEPLOYMENT.md, "Migrations".',
  );
}
