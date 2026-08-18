import { z } from "zod";

// Strict environment validation: fail fast and loud at process startup
// rather than surfacing a confusing error deep inside a request. Every
// process (Next.js apps, worker, migration/seed scripts) calls one of the
// loaders below instead of touching `process.env` directly.

const postgresUrl = z
  .string()
  .min(1, "must not be empty")
  .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
    message: "must be a postgresql:// connection string",
  });

// v1.0.1 — brief SUJET D: through v1.0, every consumer of a database
// connection string — migration/seed scripts AND, critically, each of the
// three per-role pool getters in `client-app.ts`/`client-auth.ts`/
// `client-resolver.ts` — parsed the FULL four-variable `dbEnvSchema`, even
// though each of those three files only ever reads the one field its own
// role needs. That meant narrowing what an app's own `instrumentation.ts`
// validates at startup would not actually have freed it from needing the
// other three: the first real request that touched, say, `getAppDb()`
// would still call the old `loadDbEnv()` internally and throw for a
// missing `DATABASE_URL_AUTH` it never uses — moving the failure from
// eager startup to first-request, which is a regression, not a fix. These
// four single-role schemas are the actual fix: each low-level pool getter
// below now parses only its own variable, and the per-process schemas
// further down are built from the same primitives, so "what an app
// validates at startup" and "what it can actually still fail on at
// runtime" are finally the same set.
export const adminDbEnvSchema = z.object({ DATABASE_URL: postgresUrl });
export const appDbEnvSchema = z.object({ DATABASE_URL_APP: postgresUrl });
export const resolverDbEnvSchema = z.object({ DATABASE_URL_RESOLVER: postgresUrl });
// Fourth connection (v0.2): the narrow, pre-tenant-context role used for
// session validation, login, and membership/authorization lookups. See
// docs/AUTHENTICATION.md and packages/database/src/schema.ts's `authRole`.
export const authDbEnvSchema = z.object({ DATABASE_URL_AUTH: postgresUrl });

// The full four-role set — still the right shape for scripts that
// genuinely touch every role (`db:migrate`, `db:setup-roles`, `db:seed`),
// never for a request-serving app (see the per-process schemas below).
export const dbEnvSchema = adminDbEnvSchema
  .merge(appDbEnvSchema)
  .merge(resolverDbEnvSchema)
  .merge(authDbEnvSchema);

export const nodeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const rootDomainSchema = z.object({
  ROOT_DOMAIN: z
    .string()
    .min(1)
    .regex(/^[a-z0-9.-]+$/, "must be a lowercase domain (no scheme, no port)"),
});

export const platformEnvSchema = nodeEnvSchema.merge(rootDomainSchema);

// v0.9 — Media Ingestion, Asset Lifecycle & Delivery Kernel (see
// docs/adr/0022-media-ingestion-asset-delivery.md). `MEDIA_STORAGE_PROVIDER`
// defaults to "memory" (an in-process, non-persistent store — correct for
// local dev and every automated test in this repo, never for a real
// deployment); a real deployment must set it to "s3" explicitly, which
// then requires the S3_* connection details below. Nothing here is a
// secret's *value* — only its *shape* — so this stays safe to import from
// anywhere, exactly like `dbEnvSchema` above.
export const mediaEnvSchema = z
  .object({
    MEDIA_STORAGE_PROVIDER: z.enum(["memory", "s3"]).default("memory"),
    S3_ENDPOINT: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    // v1.0.1 — brief SUJET B: deliberately left `.optional()` with no
    // `.default()` here (rather than defaulting to "false" the way this
    // field did through v1.0) so the object-level `.transform` below can
    // tell "the operator said nothing" apart from "the operator explicitly
    // said false" and pick a context-aware default only in the first case.
    // See that transform's own comment for the failure this replaces.
    S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),
    // v1.0 — the one deliberate, narrowly-scoped escape hatch from the
    // NODE_ENV=production + memory-storage guard below, used only by the
    // admin/web Playwright `webServer` configs (see
    // packages/media/src/storage/config.ts and docs/MEDIA.md). Validated
    // here (shape only, not a secret) so every caller reads it through the
    // same fail-fast mechanism as every other environment variable, instead
    // of a raw `process.env` access.
    MEDIA_ALLOW_MEMORY_IN_PRODUCTION: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .superRefine((value, ctx) => {
    if (value.MEDIA_STORAGE_PROVIDER !== "s3") return;
    for (const key of [
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `required when MEDIA_STORAGE_PROVIDER=s3`,
        });
      }
    }
  })
  .transform((value) => ({
    ...value,
    // v1.0.1 — brief SUJET B root cause fix. The AWS SDK's virtual-hosted-
    // style addressing (requesting `https://<bucket>.<host>/<key>`) is the
    // correct default for real AWS S3 (wildcard DNS under *.amazonaws.com)
    // but can never resolve against a self-hosted/non-AWS endpoint — no
    // s3rver/MinIO/etc. instance has real DNS for `<bucket>.<host>` — the
    // one exception being an endpoint that is itself a bare IP literal,
    // which the SDK already special-cases into path-style automatically.
    // Through v1.0, `S3_FORCE_PATH_STYLE` defaulted to `false` regardless,
    // so an operator who set `S3_ENDPOINT` (this codebase's own existing
    // signal for "this is not real AWS S3" — see `S3ObjectStorageConfig`'s
    // own doc comment) without *also* remembering the separate
    // `S3_FORCE_PATH_STYLE=true` variable got a DNS lookup against a
    // hostname that can never resolve. Because neither this class nor its
    // caller configured any request/connection timeout (see
    // `s3-object-storage.ts`'s own fix for that half), that failure had no
    // ceiling — some resolvers fail in milliseconds, others take far
    // longer than anyone will wait for a single `put` to return, which is
    // the exact mechanism behind v1.0's "smoke test hangs on put against
    // s3rver" observation. An explicit `S3_FORCE_PATH_STYLE` always wins;
    // this only fills the gap when the operator left it unset.
    S3_FORCE_PATH_STYLE: value.S3_FORCE_PATH_STYLE
      ? value.S3_FORCE_PATH_STYLE === "true"
      : Boolean(value.S3_ENDPOINT),
  }));

export const envSchema = dbEnvSchema.merge(platformEnvSchema);

export type Env = z.infer<typeof envSchema>;
export type DbEnv = z.infer<typeof dbEnvSchema>;
export type MediaEnv = z.infer<typeof mediaEnvSchema>;

function formatError(error: z.ZodError): never {
  const issues = error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
  throw new Error(
    `Invalid environment configuration:\n${issues.join("\n")}\n\nSee .env.example for the expected shape.`,
  );
}

/** Parses and validates the full application environment. Throws on failure. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) formatError(result.error);
  return result.data;
}

/** Parses only the database connection strings — used by migration/seed scripts. */
export function loadDbEnv(source: NodeJS.ProcessEnv = process.env): DbEnv {
  const result = dbEnvSchema.safeParse(source);
  if (!result.success) formatError(result.error);
  return result.data;
}

/** Parses only `DATABASE_URL` (the schema-owning role) — used by the admin/migration connection. */
export function loadAdminDbEnv(
  source: NodeJS.ProcessEnv = process.env,
): z.infer<typeof adminDbEnvSchema> {
  const result = adminDbEnvSchema.safeParse(source);
  if (!result.success) formatError(result.error);
  return result.data;
}

/** Parses only `DATABASE_URL_APP` — used by `client-app.ts`'s tenant-scoped pool. */
export function loadAppDbEnv(
  source: NodeJS.ProcessEnv = process.env,
): z.infer<typeof appDbEnvSchema> {
  const result = appDbEnvSchema.safeParse(source);
  if (!result.success) formatError(result.error);
  return result.data;
}

/** Parses only `DATABASE_URL_RESOLVER` — used by `client-resolver.ts`'s pool and readiness checks. */
export function loadResolverDbEnv(
  source: NodeJS.ProcessEnv = process.env,
): z.infer<typeof resolverDbEnvSchema> {
  const result = resolverDbEnvSchema.safeParse(source);
  if (!result.success) formatError(result.error);
  return result.data;
}

/** Parses only `DATABASE_URL_AUTH` — used by `client-auth.ts`'s pool. */
export function loadAuthDbEnv(
  source: NodeJS.ProcessEnv = process.env,
): z.infer<typeof authDbEnvSchema> {
  const result = authDbEnvSchema.safeParse(source);
  if (!result.success) formatError(result.error);
  return result.data;
}

/** Parses only the media-storage configuration — used by `packages/media`'s storage factory. */
export function loadMediaEnv(source: NodeJS.ProcessEnv = process.env): MediaEnv {
  const result = mediaEnvSchema.safeParse(source);
  if (!result.success) formatError(result.error);
  return result.data;
}

// v1.0.1 — brief SUJET D: per-process schemas, built from a REAL audit of
// each app's actual imports and execution paths (not the brief's own
// illustrative example matrix) — see this release's final report,
// PER-PROCESS ENVIRONMENT VALIDATION, for the exact trace per variable.
//
// apps/web: `packages/domains`'s `resolveSiteByHostname` (resolver role)
// and `packages/tenant`'s `withTenantContext` (app role) for rendering —
// see `apps/web/lib/site-page.ts` and the media delivery route. Never
// touches the auth role (web has no login) or the bare schema-owning
// `DATABASE_URL` (web never migrates/seeds).
export const webEnvSchema = nodeEnvSchema
  .merge(rootDomainSchema)
  .merge(resolverDbEnvSchema)
  .merge(appDbEnvSchema);

// apps/admin: everything web needs, PLUS the auth role — `@provence360/auth`
// (login, session, membership lookups, rate limiting) is exercised on
// every authenticated request via `apps/admin/lib/actor.ts`. Still never
// touches the bare schema-owning `DATABASE_URL` (admin never migrates).
export const adminEnvSchema = webEnvSchema.merge(authDbEnvSchema);

// apps/worker: a v0.1 placeholder — heartbeat only, no database access at
// all yet (see `apps/worker/src/index.ts`'s own doc comment: "this does
// not connect to the database — there is nothing tenant-scoped to do
// yet"). No DB role, no ROOT_DOMAIN (the worker never resolves a
// hostname), no media config (it never touches storage). Grows the day it
// gains a real job that needs one of these — see docs/ROADMAP.md.
export const workerEnvSchema = nodeEnvSchema;

export type WebEnv = z.infer<typeof webEnvSchema>;
export type AdminEnv = z.infer<typeof adminEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Parses apps/web's actual environment needs — resolver + app DB roles, platform config. Throws on failure. */
export function loadWebEnv(source: NodeJS.ProcessEnv = process.env): WebEnv {
  const result = webEnvSchema.safeParse(source);
  if (!result.success) formatError(result.error);
  return result.data;
}

/** Parses apps/admin's actual environment needs — resolver + app + auth DB roles, platform config. Throws on failure. */
export function loadAdminEnv(source: NodeJS.ProcessEnv = process.env): AdminEnv {
  const result = adminEnvSchema.safeParse(source);
  if (!result.success) formatError(result.error);
  return result.data;
}

/** Parses apps/worker's actual environment needs — today, just NODE_ENV. Throws on failure. */
export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) formatError(result.error);
  return result.data;
}

// v1.0 — brief §6/§7: beyond "is each variable individually well-formed"
// (the schemas above), a production deployment can still be dangerously
// misconfigured by a *combination* of otherwise-valid values — most often
// a dev/test default that was never overridden. This function is pure and
// synchronous (no logging, no process access beyond the env object handed
// to it) so it's trivially unit-testable; callers (each app's
// instrumentation hook, the worker's startup) decide what to do with the
// two severities it returns.
//
// `errors`: this combination must never serve traffic — the caller should
// throw and refuse to start.
// `warnings`: almost certainly wrong in a real deployment, but there is
// one legitimate reason it can be true on purpose (the E2E `webServer`
// escape hatch) — the caller should log loudly and continue, so the
// escape hatch keeps working while still being auditable in production
// logs if it's ever set somewhere it shouldn't be.
export interface DangerousProductionConfigReport {
  errors: string[];
  warnings: string[];
}

// The exact dev/CI credentials committed in .env.example and
// docker-compose.yml. A production DATABASE_URL* containing one of these
// verbatim is not a plausible coincidence — it means a real deployment's
// configuration was never overridden from the checked-in development
// default, which would otherwise silently point production at a database
// nobody is actually running (or worse, at another environment's).
const KNOWN_DEV_DB_CREDENTIALS = [
  "provence360:provence360@",
  "provence360_app:provence360_app@",
  "provence360_resolver:provence360_resolver@",
  "provence360_auth:provence360_auth@",
] as const;

/** Detects known-dangerous production configuration combinations. Pure — never throws, never logs. */
export function findDangerousProductionConfig(
  env: Partial<Env> & Partial<MediaEnv>,
): DangerousProductionConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (env.NODE_ENV !== "production") return { errors, warnings };

  // `MEDIA_ALLOW_MEMORY_IN_PRODUCTION=true` means, by its very definition,
  // "this NODE_ENV=production process is the admin/web Playwright E2E
  // webServer, not a real deployment" (see docs/MEDIA.md) — and the E2E
  // webServer configs deliberately reuse the local, seeded dev database
  // (see docs/DEPLOYMENT.md), so its connection strings legitimately *are*
  // the checked-in dev credentials. Every check below defers to that same
  // one flag rather than each growing its own separate escape hatch:
  // everything still gets reported (nothing is silently accepted), just as
  // a loud warning instead of a fatal error, so the flag stays exactly as
  // auditable as it already was for the storage check alone.
  const isE2eHarness = env.MEDIA_ALLOW_MEMORY_IN_PRODUCTION === true;
  const report = (message: string): void => {
    (isE2eHarness ? warnings : errors).push(message);
  };

  if (env.MEDIA_STORAGE_PROVIDER === "memory" && !isE2eHarness) {
    errors.push(
      "MEDIA_STORAGE_PROVIDER=memory (the default) with NODE_ENV=production: uploaded bytes " +
        'would vanish on restart and never be shared across instances. Set MEDIA_STORAGE_PROVIDER="s3".',
    );
  }
  if (isE2eHarness) {
    warnings.push(
      "MEDIA_ALLOW_MEMORY_IN_PRODUCTION=true is set. This is a deliberate escape hatch reserved " +
        "for the admin/web Playwright E2E webServer configs — it must never be set in a real " +
        "deployment's own configuration. If this is a real deployment, unset it and configure " +
        "MEDIA_STORAGE_PROVIDER=s3 instead.",
    );
  }

  const dbUrls = [
    env.DATABASE_URL,
    env.DATABASE_URL_APP,
    env.DATABASE_URL_RESOLVER,
    env.DATABASE_URL_AUTH,
  ];
  for (const url of dbUrls) {
    if (!url) continue;
    if (KNOWN_DEV_DB_CREDENTIALS.some((cred) => url.includes(cred))) {
      report(
        "A DATABASE_URL* variable still uses the checked-in development/CI default credentials " +
          "with NODE_ENV=production. This almost certainly means production was never given its " +
          "own database configuration.",
      );
      break;
    }
  }

  if (env.ROOT_DOMAIN === "localhost" || env.ROOT_DOMAIN?.endsWith(".localhost")) {
    report(
      `ROOT_DOMAIN="${env.ROOT_DOMAIN}" with NODE_ENV=production: this is a development-only value.`,
    );
  }

  return { errors, warnings };
}
