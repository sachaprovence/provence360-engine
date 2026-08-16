import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sessions, sites } from "@provence360/database";
import { getAppDb } from "@provence360/database/client-app";
import { getAuthDb } from "@provence360/database/client-auth";
import {
  createSite,
  createTenant,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";

// Defense in depth is only real if the grants are actually disjoint: the
// identity-plane role (provence360_auth) must never be able to read
// tenant content, and the tenant-scoped role (provence360_app) must never
// be able to read sessions. Neither of these is reachable through this
// codebase's current call graph — that's exactly why they need a direct
// regression test at the grant level, so a future change can't silently
// widen either role without a test failing.

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

// drizzle-postgres wraps the driver error as `Failed query: ...` and puts
// the actual Postgres error (with the real "permission denied" message)
// on `.cause` — assert against that, not the wrapper's own message.
async function expectPermissionDenied(promise: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(String((caught as Error).cause)).toMatch(/permission denied/);
}

describe("role boundary: provence360_auth", () => {
  it("has no grant on tenant content tables (sites)", async () => {
    const tenant = await createTenant();
    await createSite({ tenantId: tenant.id });

    await expectPermissionDenied(getAuthDb().select().from(sites));
  });
});

describe("role boundary: provence360_app", () => {
  it("has no grant on the sessions table at all", async () => {
    await expectPermissionDenied(getAppDb().select().from(sessions));
  });
});
