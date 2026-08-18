import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { loadAuthDbEnv } from "@provence360/validation";
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
    // v1.0.1 — brief SUJET D: parses only DATABASE_URL_AUTH — see
    // packages/validation/src/env.ts's `loadAuthDbEnv` doc comment.
    const env = loadAuthDbEnv();
    pool = postgres(env.DATABASE_URL_AUTH, { max: 10, connect_timeout: 10, idle_timeout: 60 });
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
