import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { loadDbEnv } from "@provence360/validation";
import * as schema from "../schema";

// Admin/migration connection: owns the schema, bypasses RLS (Postgres never
// applies row-level security to a table's owner). Reachable only via the
// "@provence360/database/admin" subpath — imported by this package's own
// migrate/seed/setup-roles scripts and by @provence360/testkit (which
// needs an RLS-bypassing connection to arrange and verify fixtures). That is
// the full list of legitimate callers. This is a convention boundary, not a
// technical one: nothing stops request-serving code from importing it too.
// The actual, unconditional boundary is RLS on packages/sites and
// packages/domains' write paths (see docs/SECURITY.md) — this connection is
// the one deliberate, documented exception to it, and it must never be
// reached from an app's request path.
let pool: ReturnType<typeof postgres> | undefined;

function getPool() {
  if (!pool) {
    const env = loadDbEnv();
    pool = postgres(env.DATABASE_URL, { max: 5 });
  }
  return pool;
}

export function getAdminDb() {
  return drizzle(getPool(), { schema });
}

export async function closeAdminPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
