import { checkDatabaseHealth } from "@provence360/database";
import { buildReadinessBody, logger, readinessHttpStatus } from "@provence360/observability";

// See apps/web/app/health/ready/route.ts for the full rationale (identical
// here, including why object storage isn't checked): only the database is
// required to declare this instance ready to serve traffic.
export async function GET() {
  const database = await checkDatabaseHealth();
  const body = buildReadinessBody([{ name: "database", ok: database.ok }]);
  if (body.status !== "ok") {
    logger.warn("health.readiness_failed", { checks: body.checks });
  }
  return Response.json(body, { status: readinessHttpStatus(body) });
}
