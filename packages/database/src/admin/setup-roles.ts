import { sql } from "drizzle-orm";
import { loadDbEnv } from "@provence360/validation";
import { getAdminDb } from "./db";
import { assertSafeIdentifier, ensureLoginRoles } from "./roles";

// Role bootstrap only: creates/syncs the app/resolver/auth login roles (via
// ensureLoginRoles — also called by runMigrations() before any migration
// runs, since CREATE POLICY ... TO <role> requires the role to exist) and
// grants CONNECT/USAGE, the two privileges that are unavoidably imperative
// because they reference the *database name*, which varies by environment
// (provence360_dev vs provence360_test vs whatever a deployment calls it)
// and can't be baked into a static migration file.
//
// Every other privilege — which tables, which columns, for which role — is
// declarative and versioned: see packages/database/migrations/0003_auth_role_grants.sql
// and 0000_dazzling_exiles.sql (the original per-table grants are folded
// into schema.ts's RLS policies; the resolver/auth column-level GRANTs live
// in the numbered migration, not here). This split is what makes "add a
// column, remember to re-run some script by hand" impossible: the grant
// that matters is either in a migration (runs automatically, every time,
// on every environment) or it's CONNECT/USAGE (harmless — it grants no
// access to a single row of data, only "you may open a connection").
export async function setupRoles(): Promise<void> {
  const db = getAdminDb();
  const { appCreds, resolverCreds, authCreds } = await ensureLoginRoles(db);

  const dbName = databaseNameFromUrl(loadDbEnv().DATABASE_URL);
  assertSafeIdentifier(dbName);

  for (const { user } of [appCreds, resolverCreds, authCreds]) {
    await db.execute(sql.raw(`grant connect on database "${dbName}" to "${user}"`));
    await db.execute(sql.raw(`grant usage on schema public to "${user}"`));
  }
}

function databaseNameFromUrl(raw: string): string {
  const url = new URL(raw);
  const name = url.pathname.replace(/^\//, "");
  if (!name) throw new Error(`Connection string has no database name: ${url.hostname}`);
  return name;
}
