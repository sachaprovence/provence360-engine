import { loadMediaEnv } from "@provence360/validation";
import { MemoryObjectStorage } from "./memory-object-storage";
import type { ObjectStorage } from "./object-storage";
import { S3ObjectStorage } from "./s3-object-storage";

// Memoized on `globalThis`, not a plain module-level `let` — discovered via
// a real E2E failure (an admin upload's bytes were unreachable from the
// delivery route's own `getObjectStorage()` call, in the *same* `next
// start` process): Next.js's App Router bundles each Server Action and
// each Route Handler as its own chunk, and can give each chunk its own
// copy of an imported module's top-level state, so a plain closure
// variable is not reliably "one instance per Node.js process" the way it
// is in a plain Node script or this package's own vitest suite (which
// doesn't do per-route bundling). `globalThis` is the standard escape
// hatch for this exact class of problem (the same pattern most Prisma-
// with-Next.js guides use for the client singleton) — it's the one object
// every chunk in the same process genuinely shares. This matters much
// more for `MemoryObjectStorage` (an in-process Map — a second instance
// is a second, empty store) than for a real `S3Client` (a second instance
// still talks to the same external bucket, just with a redundant
// connection pool) or `getAppDb`'s own `postgres()` pool (a second pool
// still talks to the same real database) — but memoizing all providers
// the same way is simpler than special-casing just this one.
const GLOBAL_KEY = Symbol.for("provence360.media.objectStorage");

interface GlobalWithObjectStorage {
  [GLOBAL_KEY]?: ObjectStorage;
}

/**
 * The one place `MEDIA_STORAGE_PROVIDER` is read — every caller (Server
 * Actions, the delivery route) goes through this instead of constructing
 * an adapter itself. Memoized per process: `MemoryObjectStorage` must stay
 * the *same* instance across a dev server's requests (a fresh one per call
 * would "lose" every previously uploaded object), and a real `S3Client`
 * is meant to be reused (connection pooling), not rebuilt per request.
 */
export function getObjectStorage(): ObjectStorage {
  const globalWithStorage = globalThis as GlobalWithObjectStorage;
  if (!globalWithStorage[GLOBAL_KEY]) {
    globalWithStorage[GLOBAL_KEY] = createObjectStorageFromEnv();
  }
  return globalWithStorage[GLOBAL_KEY];
}

/** Exposed for tests that need to reset the memoized instance between cases. */
export function resetObjectStorageForTests(): void {
  delete (globalThis as GlobalWithObjectStorage)[GLOBAL_KEY];
}

function createObjectStorageFromEnv(): ObjectStorage {
  const env = loadMediaEnv();
  if (env.MEDIA_STORAGE_PROVIDER === "memory") {
    // v0.9.1 — brief §11: `MemoryObjectStorage` is an in-process `Map`.
    // Even with the `globalThis` memoization above making it survive
    // *this* process's own Server Action/Route Handler chunking, it is
    // never shared across the multiple processes/instances any real
    // deployment eventually runs (serverless, multiple containers, a
    // rolling deploy) — an upload finalized on one instance is invisible
    // to a delivery request served by another. That failure mode is
    // silent and data-dependent (works fine locally with one dev-server
    // process, breaks unpredictably in production) rather than a clean
    // error, which is exactly the kind of bug this check exists to turn
    // into a loud, immediate one: refuse to even start serving requests
    // with this combination, rather than let it corrupt someone's launch
    // day. `NODE_ENV=production` + `MEDIA_STORAGE_PROVIDER=memory` (or
    // simply unset, since "memory" is the default) is never a supported
    // combination — production must set `MEDIA_STORAGE_PROVIDER=s3` with
    // real S3-compatible credentials (see docs/MEDIA.md, "Storage").
    //
    // `MEDIA_ALLOW_MEMORY_IN_PRODUCTION=true` is the one deliberate
    // escape hatch — never for a real deployment, only for the Admin/Web
    // E2E suites, which intentionally run `next build && next start`
    // (`NODE_ENV=production` is Next.js's own behavior for that command,
    // not this repo's choice — see each app's `playwright.config.ts` doc
    // comment for why a production-mode server is used for E2E at all) but
    // are not a real deployment. Explicit and auditable, not baked
    // silently into this check: only the E2E webServer configs set it.
    if (
      process.env.NODE_ENV === "production" &&
      process.env.MEDIA_ALLOW_MEMORY_IN_PRODUCTION !== "true"
    ) {
      throw new Error(
        "MEDIA_STORAGE_PROVIDER=memory (the default) is not valid with NODE_ENV=production. " +
          "MemoryObjectStorage is an in-process, non-persistent fake — correct for local " +
          "development and automated tests, never for a real deployment (uploaded bytes vanish " +
          "on restart and are never shared across multiple processes/instances). Set " +
          'MEDIA_STORAGE_PROVIDER="s3" with real S3-compatible credentials — see .env.example ' +
          "and docs/MEDIA.md.",
      );
    }
    return new MemoryObjectStorage();
  }
  return new S3ObjectStorage({
    bucket: env.S3_BUCKET as string,
    region: env.S3_REGION as string,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    accessKeyId: env.S3_ACCESS_KEY_ID as string,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
}
