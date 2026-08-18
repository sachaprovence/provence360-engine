import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { loadResolverDbEnv } from "@provence360/validation";
import * as schema from "./schema";

// Narrow, read-only connection used exclusively by the hostname resolver
// (packages/domains/src/resolver.ts). No tenant context, no transactions —
// RLS grants this role an unconditional SELECT policy on `sites` and
// `domains` only, and setup-roles.ts further restricts it at the column
// level to routing-safe fields. See docs/SECURITY.md.
let pool: ReturnType<typeof postgres> | undefined;

function getPool() {
  if (!pool) {
    // v1.0.1 — brief SUJET D: parses only DATABASE_URL_RESOLVER — see
    // packages/validation/src/env.ts's `loadResolverDbEnv` doc comment.
    const env = loadResolverDbEnv();
    pool = postgres(env.DATABASE_URL_RESOLVER, { max: 5, connect_timeout: 10, idle_timeout: 60 });
  }
  return pool;
}

export function getResolverDb() {
  return drizzle(getPool(), { schema });
}

export async function closeResolverPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
