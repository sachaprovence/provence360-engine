import postgres from "postgres";
import { loadDbEnv } from "@provence360/validation";

// v1.0 — brief §8/§36: readiness needs to know "is the database reachable"
// without borrowing a connection from any of the long-lived, tenant-scoped
// pools (`client-app.ts`/`client-resolver.ts`/`client-auth.ts`) — a
// readiness check competing with real request traffic for pool slots
// would make the symptom it's trying to detect (DB pressure) worse. This
// opens one short-lived connection, runs the cheapest possible query, and
// always closes it — bounded by its own tight `connect_timeout` so a
// hanging database can never make `/health/ready` hang.
//
// Uses `DATABASE_URL_RESOLVER` (the narrowest-privilege role) rather than
// the admin connection — readiness only needs to prove "Postgres is
// accepting connections and answering queries," not "the schema-owning
// role can reach it."
const READINESS_TIMEOUT_SECONDS = 3;

export interface DatabaseHealthResult {
  ok: boolean;
  latencyMs?: number;
  /** Never the raw driver error (may contain the connection string) — a short, client-safe reason only. */
  error?: string;
}

export async function checkDatabaseHealth(): Promise<DatabaseHealthResult> {
  const startedAt = Date.now();
  let sql: ReturnType<typeof postgres> | undefined;
  try {
    const env = loadDbEnv();
    sql = postgres(env.DATABASE_URL_RESOLVER, {
      max: 1,
      connect_timeout: READINESS_TIMEOUT_SECONDS,
      idle_timeout: READINESS_TIMEOUT_SECONDS,
    });
    await sql`select 1`;
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { ok: false, error: "database unreachable" };
  } finally {
    // `postgres()` never throws on `.end()` for a connection that never
    // fully opened — safe to call unconditionally.
    void sql?.end({ timeout: 1 });
  }
}
