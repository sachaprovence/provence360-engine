export * from "./schema";
// `getAppDb`/`closeAppPool` (the runtime pool getter) are deliberately NOT
// re-exported here. They live only at the "@provence360/database/client-app"
// subpath, imported by exactly one caller: packages/tenant's
// withTenantContext(). Everything else — repositories included — receives a
// scoped `AppTx` as a function argument, it never fetches its own handle.
// This is a convention backstop, not a hard boundary: the real,
// unconditional enforcement is Postgres RLS (see docs/SECURITY.md).
export type { AppDb, AppTx } from "./client-app";
export { getResolverDb, closeResolverPool } from "./client-resolver";
// `getAuthDb` is the same story as `getAppDb`: reachable only via
// "@provence360/database/client-auth", used only by packages/auth.
export { loadDotEnv } from "./load-env";
