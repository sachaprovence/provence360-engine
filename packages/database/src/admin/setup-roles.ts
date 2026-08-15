import { sql } from "drizzle-orm";
import { loadDbEnv } from "@provence360/validation";
import { getAdminDb } from "./db";
import { assertSafeIdentifier, ensureLoginRoles } from "./roles";

// Grants privileges to the app and resolver roles (see docs/SECURITY.md):
//
//   provence360_app      - full DML on all six tables, RLS-governed.
//   provence360_resolver - SELECT on specific routing-only columns of
//                           `sites` and `domains`.
//
// Requires the tables to already exist — run after `pnpm db:migrate`.
// Role creation itself (a precondition for the migration's `CREATE POLICY`
// statements) happens in runMigrations(), not here — see roles.ts.

function databaseNameFromUrl(raw: string): string {
  const url = new URL(raw);
  const name = url.pathname.replace(/^\//, "");
  if (!name) throw new Error(`Connection string has no database name: ${url.hostname}`);
  return name;
}

const APP_TABLES = ["users", "tenants", "memberships", "sites", "domains", "audit_logs"];

const RESOLVER_COLUMN_GRANTS: Record<string, string[]> = {
  sites: ["id", "tenant_id", "status"],
  domains: ["id", "site_id", "tenant_id", "hostname", "is_primary", "status"],
};

/** Grants the app/resolver roles the privileges described in schema.ts. Safe to run repeatedly. */
export async function setupRoles(): Promise<void> {
  const db = getAdminDb();
  const { appCreds, resolverCreds } = await ensureLoginRoles(db);

  const dbName = databaseNameFromUrl(loadDbEnv().DATABASE_URL);
  assertSafeIdentifier(dbName);

  for (const { user } of [appCreds, resolverCreds]) {
    await db.execute(sql.raw(`grant connect on database "${dbName}" to "${user}"`));
    await db.execute(sql.raw(`grant usage on schema public to "${user}"`));
  }

  for (const table of APP_TABLES) {
    assertSafeIdentifier(table);
    await db.execute(
      sql.raw(
        `grant select, insert, update, delete on table public."${table}" to "${appCreds.user}"`,
      ),
    );
  }

  for (const [table, columns] of Object.entries(RESOLVER_COLUMN_GRANTS)) {
    assertSafeIdentifier(table);
    columns.forEach(assertSafeIdentifier);
    const columnList = columns.map((c) => `"${c}"`).join(", ");
    await db.execute(
      sql.raw(`grant select (${columnList}) on table public."${table}" to "${resolverCreds.user}"`),
    );
  }
}
