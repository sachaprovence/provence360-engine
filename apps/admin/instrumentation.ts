// See apps/web/instrumentation.ts for the full rationale (identical here,
// including why the Node-only modules are behind a dynamic `import()`
// rather than a top-level one): environment configuration is validated
// once, eagerly, when the server process boots, not lazily on the first
// request that happens to touch a misconfigured piece of it.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { logger } = await import("@provence360/observability");
  const { findDangerousProductionConfig, loadEnv, loadMediaEnv } =
    await import("@provence360/validation");

  try {
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
    logger.info("application.started", { pid: process.pid, nodeEnv: env.NODE_ENV, app: "admin" });
  } catch (error) {
    logger.error("application.startup_failed", {
      app: "admin",
      error: error instanceof Error ? error.message : String(error),
    });
    // See apps/web/instrumentation.ts for why this is a hard `process.exit`
    // rather than a re-throw: an unambiguous, immediate exit for a
    // container orchestrator's restart policy to act on, instead of a
    // process left up answering every request with a generic 500.
    process.exit(1);
  }
}
