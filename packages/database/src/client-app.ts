import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { loadAppDbEnv } from "@provence360/validation";
import * as schema from "./schema";

// Tenant-scoped runtime connection: subject to RLS. Never query this
// directly — always go through `withTenantContext()` from packages/tenant,
// which opens a transaction on this pool, sets app.tenant_id for that
// transaction only, and hands the scoped transaction handle to the caller.
//
// v1.0: `connect_timeout`/`idle_timeout` (seconds) are set explicitly on
// every pool in this file's siblings, not left at the `postgres` package's
// own defaults — an unreachable database should make a request fail within
// a bounded, predictable window (readiness reports it as down; a request
// gets a clean error) rather than hang. See docs/DEPLOYMENT.md.
let pool: ReturnType<typeof postgres> | undefined;

function getPool() {
  if (!pool) {
    // v1.0.1 — brief SUJET D: parses only DATABASE_URL_APP, not the full
    // four-role dbEnvSchema — see packages/validation/src/env.ts's
    // `loadAppDbEnv` doc comment for why this matters for apps/web (which
    // never has an auth role or the bare schema-owning DATABASE_URL).
    const env = loadAppDbEnv();
    pool = postgres(env.DATABASE_URL_APP, { max: 10, connect_timeout: 10, idle_timeout: 60 });
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
