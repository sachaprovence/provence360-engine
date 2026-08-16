import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { loadDbEnv } from "@provence360/validation";
import * as schema from "./schema";

// The narrow, pre-tenant-context connection for identity and authorization
// lookups (packages/auth): session validation/creation/revocation, login
// (email + password_hash lookup), and the membership/tenant reads
// `withAuthorizedTenantContext` needs before it can even call
// `withTenantContext`. Column-restricted grants (see
// packages/database/migrations/0003_auth_role_grants.sql) keep this role
// from ever touching site/domain content or any other tenant's data — see
// docs/AUTHENTICATION.md and docs/AUTHORIZATION.md.
let pool: ReturnType<typeof postgres> | undefined;

function getPool() {
  if (!pool) {
    const env = loadDbEnv();
    pool = postgres(env.DATABASE_URL_AUTH, { max: 10 });
  }
  return pool;
}

export function getAuthDb() {
  return drizzle(getPool(), { schema });
}

export async function closeAuthPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
