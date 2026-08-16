import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit is invoked with CWD = packages/database, but the connection
// strings live in the repo root's .env (see .env.example) — load it
// explicitly rather than relying on dotenv's process.cwd() default.
config({ path: path.resolve(fileURLToPath(import.meta.url), "../../../.env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run drizzle-kit (see .env.example).");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: databaseUrl,
  },
  // Roles are declared in schema.ts with `.existing()`, so drizzle-kit
  // references them in generated `CREATE POLICY` statements without trying
  // to CREATE/DROP the roles themselves (those are managed idempotently by
  // setup-roles.ts — passwords and LOGIN don't belong in a migration).
});
