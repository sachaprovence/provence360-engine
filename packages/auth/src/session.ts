import { randomBytes, createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { sessions, users } from "@provence360/database";
import { getAuthDb } from "@provence360/database/client-auth";

// Opaque bearer tokens, not JWTs: a session is revocable the instant its
// DB row is marked revoked, with nothing to wait out (no signature that
// stays valid until an exp claim expires). The raw token is 24 random
// bytes (192 bits) base64url-encoded for the cookie; the DB never stores
// it — only its SHA-256 hex digest, as the session's primary key. Same
// defense-in-depth reasoning as password hashing: a leaked database
// (backup, replication lag, misconfigured access) doesn't hand out usable
// session tokens, only hashes an attacker still can't present as a cookie.
// See docs/adr/0007-session-strategy.md.

const TOKEN_BYTES = 24;
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RENEWAL_THRESHOLD_MS = SESSION_DURATION_MS / 2;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export interface ValidatedSession {
  id: string;
  userId: string;
  expiresAt: Date;
}

/** Creates a session for `userId` and returns the raw token — the only time it's ever available. */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await getAuthDb()
    .insert(sessions)
    .values({ id: hashToken(token), userId, expiresAt });

  return { token, expiresAt };
}

/**
 * Validates a raw session token. Returns `null` for anything short of a
 * fully valid, unrevoked, unexpired session tied to an existing user —
 * never throws for "this token doesn't work," only for genuine
 * infrastructure failures (a query the database itself rejects).
 *
 * A session past half its lifetime is transparently renewed (sliding
 * expiration) so an active user is never logged out mid-session, while an
 * abandoned token still expires on schedule.
 */
export async function validateSessionToken(
  token: string,
): Promise<{ session: ValidatedSession; user: SessionUser } | null> {
  const db = getAuthDb();
  const id = hashToken(token);

  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      userEmail: users.email,
      userName: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id));

  if (!row || row.revokedAt !== null || row.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const now = new Date();
  const shouldRenew = row.expiresAt.getTime() - now.getTime() < RENEWAL_THRESHOLD_MS;
  const nextExpiresAt = shouldRenew ? new Date(now.getTime() + SESSION_DURATION_MS) : row.expiresAt;

  await db
    .update(sessions)
    .set({ lastSeenAt: now, ...(shouldRenew ? { expiresAt: nextExpiresAt } : {}) })
    .where(eq(sessions.id, id));

  return {
    session: { id: row.sessionId, userId: row.userId, expiresAt: nextExpiresAt },
    user: { id: row.userId, email: row.userEmail, name: row.userName },
  };
}

/** Revokes a single session by its raw token (logout). Idempotent. */
export async function revokeSessionToken(token: string): Promise<void> {
  await getAuthDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, hashToken(token)), isNull(sessions.revokedAt)));
}

/**
 * Revokes every active session for a user — password change ("log out
 * everywhere") and any future admin-initiated "sign this user out" action.
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await getAuthDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
