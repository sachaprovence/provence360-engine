import { sql } from "drizzle-orm";
import { getAppDb } from "@provence360/database/client-app";
import type { AppTx } from "@provence360/database";
import { uuidSchema } from "@provence360/validation";
import { runWithTenantStore } from "./context";

/**
 * The one and only way tenant-scoped code should touch the database.
 *
 * `withTenantContext` opens a single Postgres transaction, sets
 * `app.tenant_id` for *that transaction only* via
 * `set_config('app.tenant_id', $1, true)` — the parameterized equivalent of
 * `SET LOCAL`, avoiding any string interpolation of the tenant id into SQL —
 * and hands the scoped transaction (`tx`) to `callback`. Every query issued
 * through `tx` is then subject to the RLS policies defined in
 * packages/database/src/schema.ts.
 *
 * Why a transaction and not a session-level SET: connections are pooled and
 * reused across unrelated requests. `SET` (session-level) would leak the
 * tenant id to whichever request grabs that connection next. `SET LOCAL` /
 * `set_config(..., true)` is scoped to the current transaction and is
 * unset automatically on COMMIT or ROLLBACK — nothing to leak, nothing to
 * remember to clean up.
 *
 * Fails closed: an invalid tenant id is rejected before any query runs, and
 * a request that never calls this function simply has no tenant-scoped
 * database access at all (see `getCurrentTenantId()` returning `undefined`,
 * and RLS denying rows when `app.tenant_id` was never set).
 */
export async function withTenantContext<T>(
  tenantId: string,
  callback: (tx: AppTx) => Promise<T>,
): Promise<T> {
  const parsed = uuidSchema.safeParse(tenantId);
  if (!parsed.success) {
    throw new Error(`withTenantContext: "${tenantId}" is not a valid tenant id (expected a UUID).`);
  }
  const validTenantId = parsed.data;

  const db = getAppDb();

  return runWithTenantStore(validTenantId, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${validTenantId}, true)`);
      return callback(tx);
    }),
  );
}
