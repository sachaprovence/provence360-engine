import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { AuthenticationError } from "./errors";
import { requireSessionUser } from "./current-user";
import { createSession, generateSessionToken, revokeSessionToken } from "./session";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("requireSessionUser", () => {
  it("throws AuthenticationError when there is no token at all", async () => {
    await expect(requireSessionUser(undefined)).rejects.toThrow(AuthenticationError);
  });

  it("throws AuthenticationError for an unknown token", async () => {
    await expect(requireSessionUser(generateSessionToken())).rejects.toThrow(AuthenticationError);
  });

  it("throws AuthenticationError for a revoked token", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);
    await revokeSessionToken(token);

    await expect(requireSessionUser(token)).rejects.toThrow(AuthenticationError);
  });

  it("returns the session user for a valid token", async () => {
    const user = await createUser({ email: "bob@example.test" });
    const { token } = await createSession(user.id);

    const sessionUser = await requireSessionUser(token);
    expect(sessionUser.id).toBe(user.id);
    expect(sessionUser.email).toBe("bob@example.test");
  });
});
