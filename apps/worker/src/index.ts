import { logger } from "@provence360/observability";
import { findDangerousProductionConfig, loadEnv, loadMediaEnv } from "@provence360/validation";

// Foundation v0.1 placeholder: establishes the worker as its own deployable
// app boundary (own build, own process, own container in a later phase)
// without pretending to run real background jobs yet. Scheduled jobs
// (domain re-verification, release publishing, etc.) land in a later phase
// — see docs/ROADMAP.md. This does not connect to the database: there is
// nothing tenant-scoped to do yet, and a worker with no jobs has no
// business holding a connection open.
//
// v1.0 — brief §9: even with no real jobs yet, a production process still
// needs a correct lifecycle: validated config before anything else runs,
// non-silent failure on an error that would otherwise be swallowed, and a
// shutdown that can't run twice or hang. Every piece below stays this
// small on purpose — the moment this worker gains real jobs, "let one
// finish before exiting" logic belongs alongside them, not invented here
// ahead of need.

const HEARTBEAT_INTERVAL_MS = 60_000;

function validateStartupConfig(): void {
  const env = loadEnv();
  const media = loadMediaEnv();
  const { errors, warnings } = findDangerousProductionConfig({ ...env, ...media });
  for (const warning of warnings) {
    logger.warn("security.dangerous_production_config", { warning });
  }
  if (errors.length > 0) {
    throw new Error(
      `Refusing to start with a dangerous production configuration: ${errors.join(" ")}`,
    );
  }
}

let shuttingDown = false;

function heartbeat(): void {
  logger.info("worker.heartbeat", { pid: process.pid });
}

function makeShutdown(interval: ReturnType<typeof setInterval>) {
  return function shutdown(signal: string, exitCode: number): void {
    // A second SIGTERM (common under an orchestrator's escalating stop
    // sequence) must not re-run this and double-log or double-clear.
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("worker.shutdown", { signal });
    clearInterval(interval);
    process.exit(exitCode);
  };
}

// A SIGTERM/uncaught error arriving before this point (during the
// synchronous config validation below) has nothing to clean up yet —
// Node's own default signal/crash behavior is fine for that narrow window.
try {
  validateStartupConfig();
} catch (error) {
  logger.error("worker.startup_failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}

logger.info("worker.started", { pid: process.pid });
const interval = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
const shutdown = makeShutdown(interval);

function crash(event: string, error: unknown): void {
  logger.error(event, { error: error instanceof Error ? error.message : String(error) });
  shutdown("crash", 1);
}

process.on("SIGINT", () => shutdown("SIGINT", 0));
process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("uncaughtException", (error) => crash("worker.crashed", error));
process.on("unhandledRejection", (error) => crash("worker.crashed", error));
