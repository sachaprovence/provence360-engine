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
  if (env.MEDIA_STORAGE_PROVIDER === "memory") return new MemoryObjectStorage();
  return new S3ObjectStorage({
    bucket: env.S3_BUCKET as string,
    region: env.S3_REGION as string,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    accessKeyId: env.S3_ACCESS_KEY_ID as string,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
}
