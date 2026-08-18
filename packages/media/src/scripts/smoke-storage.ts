import { randomBytes } from "node:crypto";
import { getObjectStorage } from "../storage/config";

// v1.0 — brief §15: a smoke test deliberately separate from the standard
// vitest suite, meant to be run by hand (or by a deploy pipeline) against
// whatever real `MEDIA_STORAGE_PROVIDER=s3` bucket is currently configured
// — see docs/DEPLOYMENT.md, "Object storage". Every key it touches is
// prefixed `__smoke_test__/` with a random, single-run-unique suffix, so it
// can never collide with — or, in the `list` step, be confused for — a
// real uploaded asset. Cleans up in `finally` regardless of outcome.
//
// Run:
//   pnpm --filter @provence360/media run smoke:storage
//
// against a real bucket, set MEDIA_STORAGE_PROVIDER=s3 and the S3_* vars
// first (see .env.example). Left unset, this exercises whatever the
// current environment's `getObjectStorage()` resolves to (MemoryObjectStorage
// in local dev) — useful to prove the script itself works, not a
// substitute for testing your actual bucket before a first deploy.

const KEY = `__smoke_test__/${Date.now()}-${randomBytes(6).toString("hex")}`;
const CONTENT = Buffer.from(`provence360 storage smoke test — ${new Date().toISOString()}`, "utf8");

function step(name: string): void {
  process.stdout.write(`  ${name} ... `);
}

function ok(): void {
  process.stdout.write("ok\n");
}

async function main(): Promise<void> {
  const storage = getObjectStorage();
  console.log(`Storage smoke test — key: ${KEY}`);

  try {
    step("put");
    await storage.putObject(KEY, CONTENT, { contentType: "text/plain" });
    ok();

    step("get");
    const fetched = await storage.getObject(KEY);
    if (!fetched || !fetched.equals(CONTENT)) {
      throw new Error("get returned different bytes than were put");
    }
    ok();

    step("list (prefix scoped to this run's own key)");
    const listed = await storage.listObjects(KEY.split("/")[0] + "/");
    if (!listed.includes(KEY)) {
      throw new Error(`list did not include ${KEY} — got: ${JSON.stringify(listed)}`);
    }
    ok();

    step("delete");
    await storage.deleteObject(KEY);
    ok();

    step("get after delete (must be absent)");
    const afterDelete = await storage.getObject(KEY);
    if (afterDelete !== null) {
      throw new Error("object still readable after delete");
    }
    ok();

    console.log("Storage smoke test: PASSED");
  } catch (error) {
    console.log("FAILED");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    // Never leave the probe object behind, success or failure — and never
    // touch any key but this run's own.
    await storage.deleteObject(KEY).catch(() => {});
  }
}

void main();
