import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, users } from "@provence360/database";
import { getAdminDb } from "@provence360/database/admin";
import { createUser, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { AUTH_LOGIN_FAILURE, AUTH_LOGIN_SUCCESS } from "./audit-events";
import { InvalidCredentialsError, login } from "./login";
import { LoginRateLimitedError } from "./rate-limit";
import { hashPassword } from "./password";
import { validateSessionToken } from "./session";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

async function createUserWithPassword(email: string, password: string) {
  const user = await createUser({ email });
  await getAdminDb()
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, user.id));
  return user;
}

describe("login", () => {
  it("succeeds with the correct email and password, and returns a working session", async () => {
    await createUserWithPassword("carol@example.test", "correct-password-123");

    const result = await login("carol@example.test", "correct-password-123");

    expect(result.token).toBeTruthy();
    const validated = await validateSessionToken(result.token);
    expect(validated?.user.email).toBe("carol@example.test");
  });

  it("records an AUTH_LOGIN_SUCCESS audit event with tenantId null", async () => {
    const user = await createUserWithPassword("dave@example.test", "correct-password-123");
    await login("dave@example.test", "correct-password-123");

    const rows = await getAdminDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, AUTH_LOGIN_SUCCESS));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBeNull();
    expect(rows[0]?.actorUserId).toBe(user.id);
  });

  it("rejects a wrong password with InvalidCredentialsError", async () => {
    await createUserWithPassword("erin@example.test", "correct-password-123");

    await expect(login("erin@example.test", "wrong-password")).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it("rejects an unknown email with the same InvalidCredentialsError (no enumeration)", async () => {
    await expect(login("nobody@example.test", "whatever")).rejects.toThrow(InvalidCredentialsError);
  });

  it("a wrong password and an unknown email produce identical error messages", async () => {
    await createUserWithPassword("frank@example.test", "correct-password-123");

    const wrongPasswordError = await login("frank@example.test", "wrong").catch((e: unknown) => e);
    const unknownEmailError = await login("nobody@example.test", "wrong").catch((e: unknown) => e);

    expect((wrongPasswordError as Error).message).toBe((unknownEmailError as Error).message);
  });

  it("rejects a user that exists but has no password set (e.g. provisioned without one)", async () => {
    await createUser({ email: "no-password@example.test" });

    await expect(login("no-password@example.test", "anything")).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it("records an AUTH_LOGIN_FAILURE audit event on bad credentials, without ever storing the password", async () => {
    await createUserWithPassword("grace@example.test", "correct-password-123");
    await login("grace@example.test", "wrong-password").catch(() => undefined);

    const rows = await getAdminDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, AUTH_LOGIN_FAILURE));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBeNull();
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain("wrong-password");
  });

  it("rate-limits after repeated failures for the same email", async () => {
    await createUserWithPassword("henry@example.test", "correct-password-123");

    for (let i = 0; i < 10; i++) {
      await login("henry@example.test", "wrong-password").catch(() => undefined);
    }

    await expect(login("henry@example.test", "wrong-password")).rejects.toThrow(
      LoginRateLimitedError,
    );
    // Even the *correct* password is refused once rate-limited — the limit
    // is on the account, not merely on repeating a specific wrong guess.
    await expect(login("henry@example.test", "correct-password-123")).rejects.toThrow(
      LoginRateLimitedError,
    );
  });

  it("rate limiting is scoped per email — another account is unaffected", async () => {
    await createUserWithPassword("ivan@example.test", "correct-password-123");
    await createUserWithPassword("judy@example.test", "correct-password-123");

    for (let i = 0; i < 10; i++) {
      await login("ivan@example.test", "wrong-password").catch(() => undefined);
    }

    await expect(login("judy@example.test", "correct-password-123")).resolves.toBeDefined();
  });

  it("normalizes email casing/whitespace itself, rather than trusting the caller to", async () => {
    await createUserWithPassword("karen@example.test", "correct-password-123");

    // A caller that forgot to trim/lowercase (e.g. a future non-web client)
    // must still succeed against the stored (lowercase) email — and, just
    // as importantly, must count against the *same* rate-limit bucket as
    // the canonical form, not a fresh one per casing variant.
    const result = await login("  Karen@Example.TEST  ", "correct-password-123");
    expect(result.userId).toBeDefined();
  });

  it("rate limiting is not bypassable by varying the email's case per attempt", async () => {
    await createUserWithPassword("liam@example.test", "correct-password-123");

    const variants = [
      "liam@example.test",
      "Liam@example.test",
      "LIAM@EXAMPLE.TEST",
      "liam@Example.Test",
    ];
    for (let i = 0; i < 10; i++) {
      const email = variants[i % variants.length] as string;
      await login(email, "wrong-password").catch(() => undefined);
    }

    await expect(login("liam@example.test", "correct-password-123")).rejects.toThrow(
      LoginRateLimitedError,
    );
  });
});
