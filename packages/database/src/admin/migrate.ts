import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getAdminDb } from "./db";
import { ensureLoginRoles } from "./roles";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

/**
 * Applies all pending Drizzle migrations against the admin connection.
 * Ensures the app/resolver login roles exist first — the migration's
 * `CREATE POLICY ... TO "provence360_app"` statements fail otherwise, since
 * a policy can't reference a role that doesn't exist yet. Grants (which
 * need the tables this function is about to create) are a separate step —
 * see setup-roles.ts.
 */
export async function runMigrations(): Promise<void> {
  const db = getAdminDb();
  await ensureLoginRoles(db);
  await migrate(db, { migrationsFolder });
}
