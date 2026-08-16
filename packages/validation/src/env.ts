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

export const envSchema = dbEnvSchema.merge(platformEnvSchema);

export type Env = z.infer<typeof envSchema>;
export type DbEnv = z.infer<typeof dbEnvSchema>;

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
