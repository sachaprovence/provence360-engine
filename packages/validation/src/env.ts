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
