import { eq } from "drizzle-orm";
import { users } from "@provence360/database";
import { getAuthDb } from "@provence360/database/client-auth";
import { createRequestLogger, generateRequestId } from "@provence360/observability";
import { AUTH_LOGIN_FAILURE, AUTH_LOGIN_SUCCESS } from "./audit-events";
import { recordAuthAuditEvent } from "./audit";
import { hashPassword, verifyPassword } from "./password";
import { assertLoginNotRateLimited } from "./rate-limit";
import { createSession } from "./session";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}

// Hashing is the expensive part of a login attempt by design (that's the
// whole point of argon2). If "email doesn't exist" skips the hash and
// "email exists, password wrong" doesn't, the response latency itself
// becomes a user-enumeration oracle. Verifying against a fixed dummy hash
// on the unknown-email path keeps both branches doing comparable work.
// Computed lazily (module-load-time argon2 would slow down every cold
// start of every process that imports this file, most of which never
// handle a login) and memoized (computed once per process, not once per
// failed attempt).
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("provence360-timing-safety-placeholder");
  return dummyHash;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  userId: string;
}

/**
 * Verifies email + password, records the attempt (AUTH_LOGIN_SUCCESS or
 * AUTH_LOGIN_FAILURE, tenant_id NULL — this is an identity-plane event,
 * not yet tied to any tenant), and creates a session on success. Throws
 * {@link InvalidCredentialsError} (bad credentials) or
 * {@link LoginRateLimitedError} (too many recent failures) — the caller
 * decides how to render either as a response, but never with more detail
 * than "invalid email or password" (never "no such user," never "wrong
 * password" — see docs/SECURITY.md on not revealing account existence).
 */
export async function login(rawEmail: string, plainTextPassword: string): Promise<LoginResult> {
  // Normalized here, not just trusted to the caller: apps/admin's own
  // login form already trims/lowercases, but this function shouldn't rely
  // on every future caller remembering to. Without it, `Alice@x.test` and
  // `alice@x.test` would look like two different emails to the exact-match
  // `eq()` lookup and to the rate limiter's per-email count below — never
  // enough to grant access to an account whose stored email is lowercase
  // (the lookup would simply miss), but enough to needlessly fragment the
  // rate-limit counter across case variants of the same attempted account.
  const email = rawEmail.trim().toLowerCase();
  const log = createRequestLogger({ requestId: generateRequestId() });
  await assertLoginNotRateLimited(email);

  const [user] = await getAuthDb()
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));

  const passwordIsValid = await verifyPassword(
    user?.passwordHash ?? (await getDummyHash()),
    plainTextPassword,
  );

  if (!user || !user.passwordHash || !passwordIsValid) {
    await recordAuthAuditEvent({
      action: AUTH_LOGIN_FAILURE,
      targetType: "user",
      ...(user ? { targetId: user.id } : {}),
      metadata: { email },
    });
    // Never log `plainTextPassword` itself — only that an attempt failed
    // and for which email. The logger's own redaction (see
    // packages/observability/src/logger.ts) is a backstop, not relied on
    // here: this call never passes the password field in the first place.
    log.warn("login failed", { email, ...(user ? { userId: user.id } : {}) });
    throw new InvalidCredentialsError();
  }

  await recordAuthAuditEvent({
    actorUserId: user.id,
    action: AUTH_LOGIN_SUCCESS,
    targetType: "user",
    targetId: user.id,
    metadata: { email },
  });

  log.info("login succeeded", { userId: user.id });

  const { token, expiresAt } = await createSession(user.id);
  return { token, expiresAt, userId: user.id };
}
