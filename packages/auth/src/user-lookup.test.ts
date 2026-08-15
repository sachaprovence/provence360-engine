import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { findUserByEmail } from "./user-lookup";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("findUserByEmail", () => {
  it("finds an existing user by exact email", async () => {
    const user = await createUser({ email: "nadia@example.test" });

    const found = await findUserByEmail("nadia@example.test");
    expect(found?.id).toBe(user.id);
  });

  it("returns null for an email with no account — this is the only place that's an acceptable leak (an authenticated, member.invite-gated lookup, not the anonymous login endpoint)", async () => {
    const found = await findUserByEmail("nobody@example.test");
    expect(found).toBeNull();
  });

  it("normalizes casing and surrounding whitespace before looking up", async () => {
    const user = await createUser({ email: "oscar@example.test" });

    const found = await findUserByEmail("  Oscar@Example.TEST  ");
    expect(found?.id).toBe(user.id);
  });
});
