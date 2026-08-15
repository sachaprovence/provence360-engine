import { sql } from "drizzle-orm";
import { loadDbEnv } from "@provence360/validation";
import type { getAdminDb } from "./db";

// Split out from setup-roles.ts because of a real ordering constraint: the
// schema migration's `CREATE POLICY ... TO "provence360_app"` statements
// require the role to already exist, but the *grants* (setup-roles.ts)
// need the tables to already exist. Role creation has no such dependency in
// either direction, so `runMigrations()` (migrate.ts) calls this first,
// and `setupRoles()` (setup-roles.ts) also calls it defensively — both
// entry points are self-sufficient regardless of which one runs first.

export interface Creds {
  user: string;
  password: string;
}

export function credsFromUrl(raw: string): Creds {
  const url = new URL(raw);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!user || !password) {
    throw new Error(`Connection string is missing a username or password: ${url.hostname}`);
  }
  return { user, password };
}

export function assertSafeIdentifier(name: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to use "${name}" as a SQL identifier — unexpected characters.`);
  }
}

function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

type Db = ReturnType<typeof getAdminDb>;

async function ensureLoginRole(db: Db, { user, password }: Creds): Promise<void> {
  assertSafeIdentifier(user);
  const passwordLiteral = escapeLiteral(password);

  const existing = await db.execute(sql`select 1 from pg_roles where rolname = ${user}`);
  if (existing.length === 0) {
    await db.execute(
      sql.raw(`create role "${user}" with login password '${passwordLiteral}' noinherit`),
    );
  } else {
    await db.execute(sql.raw(`alter role "${user}" with login password '${passwordLiteral}'`));
  }
}

export interface EnsuredRoles {
  appCreds: Creds;
  resolverCreds: Creds;
}

/** Idempotently creates (or syncs the password of) the app and resolver login roles. */
export async function ensureLoginRoles(db: Db): Promise<EnsuredRoles> {
  const env = loadDbEnv();
  const appCreds = credsFromUrl(env.DATABASE_URL_APP);
  const resolverCreds = credsFromUrl(env.DATABASE_URL_RESOLVER);

  await ensureLoginRole(db, appCreds);
  await ensureLoginRole(db, resolverCreds);

  return { appCreds, resolverCreds };
}
