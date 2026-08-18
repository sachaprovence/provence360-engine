import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `index.ts` runs its startup sequence (config validation, signal
// handlers, the heartbeat interval) as top-level side effects the moment
// it's imported — there's no exported function to call in isolation.
// Spawning the real script as a child process, exactly how `pnpm start`
// runs it, is what actually proves the lifecycle works end to end (startup
// validation, graceful shutdown, exit codes) rather than mocking around
// the one thing this file exists to get right. Mirrors the manual
// verification this behavior was originally proven with.

const entrypoint = path.resolve(fileURLToPath(import.meta.url), "../index.ts");
const workerRoot = path.resolve(fileURLToPath(import.meta.url), "../..");

const VALID_ENV = {
  ...process.env,
  DATABASE_URL: "postgresql://provence360:provence360@localhost:5432/provence360_dev",
  DATABASE_URL_APP: "postgresql://provence360_app:provence360_app@localhost:5432/provence360_dev",
  DATABASE_URL_RESOLVER:
    "postgresql://provence360_resolver:provence360_resolver@localhost:5432/provence360_dev",
  DATABASE_URL_AUTH:
    "postgresql://provence360_auth:provence360_auth@localhost:5432/provence360_dev",
  ROOT_DOMAIN: "provence360.app",
  NODE_ENV: "development",
};

function readLines(chunks: Buffer[]): unknown[] {
  return Buffer.concat(chunks)
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

describe("apps/worker's real startup/shutdown lifecycle (spawned as a real process)", () => {
  it("logs worker.started then exits 0 with worker.shutdown on SIGTERM — not a zombie, not a hang", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", entrypoint], {
      cwd: workerRoot,
      env: VALID_ENV,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("worker never logged worker.started")),
        10_000,
      );
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString("utf8").includes("worker.started")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    child.kill("SIGTERM");
    const exitCode = await new Promise<number | null>((resolve) => child.on("exit", resolve));

    expect(exitCode).toBe(0);
    const events = readLines(stdout) as Array<{ message: string }>;
    expect(events.some((e) => e.message === "worker.started")).toBe(true);
    expect(events.some((e) => e.message === "worker.shutdown")).toBe(true);
  }, 15_000);

  it("refuses to start and exits 1 with worker.startup_failed on a dangerous production config", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", entrypoint], {
      cwd: workerRoot,
      env: {
        ...VALID_ENV,
        NODE_ENV: "production",
        // Deliberately no MEDIA_ALLOW_MEMORY_IN_PRODUCTION escape hatch —
        // this must be refused, not silently accepted.
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    // logger.error writes to stderr, not stdout — see packages/observability's logger.ts.
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk));

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker never exited")), 10_000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(exitCode).toBe(1);
    const events = readLines(output) as Array<{ message: string }>;
    expect(events.some((e) => e.message === "worker.startup_failed")).toBe(true);
    expect(events.some((e) => e.message === "worker.started")).toBe(false);
  }, 15_000);
});
