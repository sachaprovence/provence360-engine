// v1.0 — brief §6: environment configuration is validated once, eagerly,
// when the server process boots — not lazily, the first time some request
// happens to touch a misconfigured piece of it. Next.js calls `register()`
// exactly once per server instance, before it serves any request (see
// https://nextjs.org/docs/app/guides/instrumentation). Throwing here
// aborts startup instead of letting a broken process come up and serve
// traffic badly.
//
// Next also calls `register()` once for the Edge runtime (a separate,
// lighter environment this app doesn't otherwise use) — `NEXT_RUNTIME` is
// set by Next itself, not user configuration. The actual validation logic
// lives behind a `dynamic import()` rather than a top-level one: Node-only
// modules (this pulls in `node:crypto`, `node:fs`, ...) imported at the top
// of this file get statically bundled into *both* runtime variants, and
// the Edge one can't load them — a dynamic import keeps them out of that
// bundle entirely instead of merely not executing them at runtime.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { logger } = await import("@provence360/observability");
  const { findDangerousProductionConfig, loadWebEnv, loadMediaEnv } =
    await import("@provence360/validation");

  try {
    // v1.0.1 — brief SUJET D: `loadWebEnv()` validates only what apps/web
    // actually consumes (resolver + app DB roles, platform config) — not
    // the auth role or the bare schema-owning DATABASE_URL, neither of
    // which web ever touches. See packages/validation/src/env.ts's
    // `webEnvSchema` doc comment for the real import trace behind this.
    const env = loadWebEnv();
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
    logger.info("application.started", { pid: process.pid, nodeEnv: env.NODE_ENV, app: "web" });
  } catch (error) {
    logger.error("application.startup_failed", {
      app: "web",
      error: error instanceof Error ? error.message : String(error),
    });
    // Throwing alone left Next.js's own server catching it as an
    // `unhandledRejection` and leaving the HTTP listener up, answering
    // every request (including `/health/live`) with a generic 500 —
    // "serving broken traffic" rather than "not serving at all." A
    // container orchestrator's restart policy needs the second one: a
    // process that has actually exited is an unambiguous, immediate
    // signal, instead of depending on a health check probe's interval to
    // notice and act.
    process.exit(1);
  }
}
