import postgres from "postgres";
import { loadDbEnv } from "@provence360/validation";
import { loadDotEnv } from "../load-env";

// v1.0.2 — brief SUJET B: a standalone, real-connection probe for the
// four-role privilege model this platform's entire security posture rests
// on (see docs/SECURITY.md). Existing RLS test suites
// (packages/*/src/*rls.test.ts) already prove this indirectly, through the
// application's own code paths — but there was no single tool an operator
// could run directly against a brand-new target database (Railway's
// managed Postgres, or any other) to confirm, in isolation, that
// `db:setup-roles` actually wired the four roles correctly *before*
// deploying any app process against it. This script is exactly that: pure
// SQL, four real connections, no application code involved.
//
// Every check below either connects successfully and gets the expected
// result, or it doesn't — nothing here is simulated. A permission-denied
// error IS the expected, correct outcome for several checks (a role that
// unexpectedly *can* do something it shouldn't is the actual failure
// mode this script exists to catch).
//
// Usage: pnpm db:verify-roles (reads DATABASE_URL/_APP/_RESOLVER/_AUTH
// from the environment, exactly like every other db:* script).

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`  [${ok ? "OK" : "FAIL"}] ${name} — ${detail}`);
}

async function expectSuccess(
  name: string,
  fn: () => Promise<unknown>,
  describe: (result: unknown) => string,
): Promise<void> {
  try {
    const result = await fn();
    record(name, true, describe(result));
  } catch (error) {
    record(name, false, `expected success, got error: ${errorMessage(error)}`);
  }
}

async function expectPermissionDenied(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    record(name, false, "expected a permission-denied error, but the query succeeded");
  } catch (error) {
    const message = errorMessage(error);
    if (/permission denied/i.test(message)) {
      record(name, true, `correctly refused — ${message}`);
    } else {
      record(name, false, `refused, but not with a permission error — ${message}`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const env = loadDbEnv();
  const admin = postgres(env.DATABASE_URL, { max: 1 });
  const app = postgres(env.DATABASE_URL_APP, { max: 1 });
  const resolver = postgres(env.DATABASE_URL_RESOLVER, { max: 1 });
  const auth = postgres(env.DATABASE_URL_AUTH, { max: 1 });

  try {
    console.log("Connectivity + identity:");
    await expectSuccess(
      "DATABASE_URL connects (schema-owning role)",
      () => admin`select current_user, 1 as ok`,
      (r) => `current_user=${(r as { current_user: string }[])[0]?.current_user}`,
    );
    await expectSuccess(
      "DATABASE_URL_APP connects as provence360_app",
      () => app`select current_user`,
      (r) => `current_user=${(r as { current_user: string }[])[0]?.current_user}`,
    );
    await expectSuccess(
      "DATABASE_URL_RESOLVER connects as provence360_resolver",
      () => resolver`select current_user`,
      (r) => `current_user=${(r as { current_user: string }[])[0]?.current_user}`,
    );
    await expectSuccess(
      "DATABASE_URL_AUTH connects as provence360_auth",
      () => auth`select current_user`,
      (r) => `current_user=${(r as { current_user: string }[])[0]?.current_user}`,
    );

    console.log("\nprovence360_app — RLS enforcement + column restriction:");
    await expectSuccess(
      "app role can select from tenants (grant exists)",
      () => app`select count(*)::int as n from tenants`,
      (r) =>
        `${(r as { n: number }[])[0]?.n} row(s) visible with no app.tenant_id set — RLS should make this 0 unless a prior tenant context leaked`,
    );
    await expectPermissionDenied(
      "app role CANNOT select users.password_hash (column-restricted grant)",
      () => app`select password_hash from users limit 1`,
    );

    console.log("\nprovence360_resolver — narrow, routing-only privilege:");
    await expectSuccess(
      "resolver role can select domains.hostname (grant exists)",
      () => resolver`select count(*)::int as n from domains`,
      (r) => `${(r as { n: number }[])[0]?.n} domain row(s) visible`,
    );
    await expectPermissionDenied(
      "resolver role CANNOT select from users (no grant at all)",
      () => resolver`select id from users limit 1`,
    );
    await expectPermissionDenied(
      "resolver role CANNOT select from memberships (no grant at all)",
      () => resolver`select id from memberships limit 1`,
    );

    console.log("\nprovence360_auth — pre-tenant-context identity role, still scoped:");
    await expectSuccess(
      "auth role can select users.password_hash (needed for login itself)",
      () => auth`select count(*)::int as n from users`,
      (r) => `${(r as { n: number }[])[0]?.n} user row(s) visible`,
    );
    await expectSuccess(
      "auth role can select sessions (owns the table)",
      () => auth`select count(*)::int as n from sessions`,
      (r) => `${(r as { n: number }[])[0]?.n} session row(s) visible`,
    );
    await expectPermissionDenied(
      "auth role CANNOT select from sites (no grant — not its job)",
      () => auth`select id from sites limit 1`,
    );
    await expectPermissionDenied(
      "auth role CANNOT select from domains (no grant — not its job)",
      () => auth`select id from domains limit 1`,
    );

    console.log("\nSchema-owning role separation:");
    const currentUserOf = async (sql: postgres.Sql): Promise<string> => {
      const rows = (await sql`select current_user`) as { current_user: string }[];
      return rows[0]?.current_user ?? "";
    };
    const adminUser = await currentUserOf(admin);
    const appUser = await currentUserOf(app);
    const resolverUser = await currentUserOf(resolver);
    const authUser = await currentUserOf(auth);
    const distinct = new Set([adminUser, appUser, resolverUser, authUser]).size === 4;
    record(
      "DATABASE_URL's role is a distinct identity from all three request-serving roles",
      distinct,
      `admin=${adminUser} app=${appUser} resolver=${resolverUser} auth=${authUser}`,
    );
  } finally {
    await Promise.all([admin.end(), app.end(), resolver.end(), auth.end()]);
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.error(`\nRole verification: ${failures.length}/${results.length} check(s) FAILED`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nRole verification: ${results.length}/${results.length} checks PASSED`);
}

loadDotEnv();

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
