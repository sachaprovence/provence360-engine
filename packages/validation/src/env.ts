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

export const dbEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
  DATABASE_URL_APP: postgresUrl,
  DATABASE_URL_RESOLVER: postgresUrl,
  // Fourth connection (v0.2): the narrow, pre-tenant-context role used for
  // session validation, login, and membership/authorization lookups. See
  // docs/AUTHENTICATION.md and packages/database/src/schema.ts's `authRole`.
  DATABASE_URL_AUTH: postgresUrl,
});

export const platformEnvSchema = z.object({
  ROOT_DOMAIN: z
    .string()
    .min(1)
    .regex(/^[a-z0-9.-]+$/, "must be a lowercase domain (no scheme, no port)"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

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
    S3_FORCE_PATH_STYLE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
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
  });

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

/** Parses only the media-storage configuration — used by `packages/media`'s storage factory. */
export function loadMediaEnv(source: NodeJS.ProcessEnv = process.env): MediaEnv {
  const result = mediaEnvSchema.safeParse(source);
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
