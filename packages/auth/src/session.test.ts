import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sessions } from "@provence360/database";
import { getAdminDb } from "@provence360/database/admin";
import { createUser, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import {
  createSession,
  generateSessionToken,
  revokeAllUserSessions,
  revokeSessionToken,
  validateSessionToken,
} from "./session";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("createSession / validateSessionToken", () => {
  it("round-trips: a freshly created session validates to the same user", async () => {
    const user = await createUser({ email: "alice@example.test", name: "Alice" });
    const { token, expiresAt } = await createSession(user.id);

    expect(token).toBeTruthy();
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const validated = await validateSessionToken(token);
    expect(validated).not.toBeNull();
    expect(validated?.user.id).toBe(user.id);
    expect(validated?.user.email).toBe("alice@example.test");
    expect(validated?.session.userId).toBe(user.id);
  });

  it("never stores the raw token in the database — only its hash", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);

    const rows = await getAdminDb().select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(token);
  });

  it("rejects a garbage/unknown token", async () => {
    await expect(validateSessionToken("not-a-real-token")).resolves.toBeNull();
  });

  it("rejects an empty token", async () => {
    await expect(validateSessionToken("")).resolves.toBeNull();
  });

  it("rejects a well-formed but never-issued token", async () => {
    await expect(validateSessionToken(generateSessionToken())).resolves.toBeNull();
  });

  it("rejects an expired session", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);
    // Force expiry directly in the DB — createSession always sets a future
    // expiresAt, so this simulates the passage of time.
    await getAdminDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, user.id));

    await expect(validateSessionToken(token)).resolves.toBeNull();
  });

  it("rejects a revoked session", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);

    await revokeSessionToken(token);

    await expect(validateSessionToken(token)).resolves.toBeNull();
  });
});

describe("revokeSessionToken", () => {
  it("is idempotent — revoking twice does not throw", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);

    await revokeSessionToken(token);
    await expect(revokeSessionToken(token)).resolves.not.toThrow();
  });

  it("revoking an unknown token does not throw", async () => {
    await expect(revokeSessionToken(generateSessionToken())).resolves.not.toThrow();
  });

  it("only revokes the targeted session, not other sessions for the same user", async () => {
    const user = await createUser();
    const sessionA = await createSession(user.id);
    const sessionB = await createSession(user.id);

    await revokeSessionToken(sessionA.token);

    await expect(validateSessionToken(sessionA.token)).resolves.toBeNull();
    await expect(validateSessionToken(sessionB.token)).resolves.not.toBeNull();
  });
});

describe("revokeAllUserSessions", () => {
  it("revokes every active session for the user, leaving other users' sessions untouched", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const sessionA1 = await createSession(userA.id);
    const sessionA2 = await createSession(userA.id);
    const sessionB = await createSession(userB.id);

    await revokeAllUserSessions(userA.id);

    await expect(validateSessionToken(sessionA1.token)).resolves.toBeNull();
    await expect(validateSessionToken(sessionA2.token)).resolves.toBeNull();
    await expect(validateSessionToken(sessionB.token)).resolves.not.toBeNull();
  });
});
