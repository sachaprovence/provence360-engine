import { logger } from "@provence360/observability";

// Foundation v0.1 placeholder: establishes the worker as its own deployable
// app boundary (own build, own process, own container in a later phase)
// without pretending to run real background jobs yet. Scheduled jobs
// (domain re-verification, release publishing, etc.) land in a later phase
// — see docs/ROADMAP.md. This does not connect to the database: there is
// nothing tenant-scoped to do yet, and a worker with no jobs has no
// business holding a connection open.

const HEARTBEAT_INTERVAL_MS = 60_000;

function heartbeat(): void {
  logger.info("worker.heartbeat", { pid: process.pid });
}

logger.info("worker.started", { pid: process.pid });
const interval = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

function shutdown(signal: string): void {
  logger.info("worker.shutdown", { signal });
  clearInterval(interval);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
