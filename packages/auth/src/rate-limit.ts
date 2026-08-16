import { and, eq, gt, sql } from "drizzle-orm";
import { auditLogs } from "@provence360/database";
import { getAuthDb } from "@provence360/database/client-auth";
import { AUTH_LOGIN_FAILURE } from "./audit-events";

// A deliberately simple, DB-backed brute-force mitigation on the login
// endpoint (see docs/AUTHENTICATION.md#rate-limiting). DB-backed rather
// than in-memory: an in-memory counter is a lie the moment this runs as
// more than one process (which any real deployment eventually does) — each
// instance would have its own counter, and the effective limit becomes
// (threshold × instance count). Reusing audit_logs' AUTH_LOGIN_FAILURE
// rows means no new table, no new infrastructure, and the count is exact
// regardless of how many app instances are running.
//
// This is intentionally coarse: per-email, not per-IP (no trusted
// client-IP plumbing exists yet — see docs/AUTHENTICATION.md for why that's
// a documented gap, not a silent one) and windowed rather than a proper
// token-bucket. It stops naive credential-stuffing against one account; it
// is not a general-purpose WAF.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 10;

/** Throws {@link LoginRateLimitedError} if `email` has failed to log in too many times recently. */
export async function assertLoginNotRateLimited(email: string): Promise<void> {
  const since = new Date(Date.now() - WINDOW_MS);

  const [row] = await getAuthDb()
    .select({ count: sql<number>`count(*)` })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, AUTH_LOGIN_FAILURE),
        sql`${auditLogs.metadata} ->> 'email' = ${email}`,
        gt(auditLogs.createdAt, since),
      ),
    );

  if ((row?.count ?? 0) >= MAX_FAILURES_PER_WINDOW) {
    throw new LoginRateLimitedError();
  }
}

export class LoginRateLimitedError extends Error {
  constructor() {
    super("Too many failed login attempts. Try again later.");
    this.name = "LoginRateLimitedError";
  }
}
