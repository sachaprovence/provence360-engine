import { logger } from "@provence360/observability";
import { findDangerousProductionConfig, loadWorkerEnv } from "@provence360/validation";

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
  // v1.0.1 — brief SUJET D: `loadWorkerEnv()` validates only what the
  // worker actually consumes today — NODE_ENV, nothing else. No DB role
  // (see this file's own top comment: no database access exists yet), no
  // ROOT_DOMAIN (the worker never resolves a hostname), no media config
  // (it never touches storage) — a Next/web-only variable must never block
  // worker startup, and this is the concrete fix for that. Still calls
  // `findDangerousProductionConfig()` for the same reason web/admin do —
  // fail-fast validate-then-check-dangerous-combos structure preserved —
  // even though today's minimal env gives it nothing DB/media/domain-
  // related to flag; the day a real job needs one of those, extending
  // `workerEnvSchema` makes this check start covering it automatically.
  const env = loadWorkerEnv();
  const { errors, warnings } = findDangerousProductionConfig({ ...env });
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

const interval = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
const shutdown = makeShutdown(interval);

function crash(event: string, error: unknown): void {
  logger.error(event, { error: error instanceof Error ? error.message : String(error) });
  shutdown("crash", 1);
}

// v1.0.1 — brief §31 (worker SIGTERM regression replay), found while
// writing SUJET D's own worker lifecycle test: registered BEFORE logging
// "worker.started" below, not after. A SIGTERM sent the instant an
// observer (an orchestrator, this repo's own test) sees "worker.started"
// logged used to race a real, if narrow, window where these handlers
// weren't attached yet — falling back to Node's default (immediate,
// non-graceful) SIGTERM behavior instead of running `shutdown()`. Ordinary
// system load was enough to occasionally lose that race, surfaced as an
// intermittent `exitCode: null` (killed by the raw signal, not
// `process.exit(0)`) instead of a clean, logged shutdown.
process.on("SIGINT", () => shutdown("SIGINT", 0));
process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("uncaughtException", (error) => crash("worker.crashed", error));
process.on("unhandledRejection", (error) => crash("worker.crashed", error));

logger.info("worker.started", { pid: process.pid });
