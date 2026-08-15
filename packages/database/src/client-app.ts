import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { loadDbEnv } from "@provence360/validation";
import * as schema from "./schema";

// Tenant-scoped runtime connection: subject to RLS. Never query this
// directly — always go through `withTenantContext()` from packages/tenant,
// which opens a transaction on this pool, sets app.tenant_id for that
// transaction only, and hands the scoped transaction handle to the caller.
let pool: ReturnType<typeof postgres> | undefined;

function getPool() {
  if (!pool) {
    const env = loadDbEnv();
    pool = postgres(env.DATABASE_URL_APP, { max: 10 });
  }
  return pool;
}

export function getAppDb() {
  return drizzle(getPool(), { schema });
}

export type AppDb = ReturnType<typeof getAppDb>;
export type AppTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

export async function closeAppPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
