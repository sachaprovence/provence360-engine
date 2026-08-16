import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "dotenv";

// This file lives at packages/database/src/load-env.ts; four ".." segments
// (the first strips the filename itself) resolve to the repo root.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");

/** Loads `.env.test` under NODE_ENV=test, `.env` otherwise. Idempotent. */
export function loadDotEnv(): void {
  const file = process.env.NODE_ENV === "test" ? ".env.test" : ".env";
  const fullPath = path.join(repoRoot, file);
  if (existsSync(fullPath)) {
    config({ path: fullPath });
  }
}
