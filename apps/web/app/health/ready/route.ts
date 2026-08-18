import { checkDatabaseHealth } from "@provence360/database";
import { buildReadinessBody, logger, readinessHttpStatus } from "@provence360/observability";

// Readiness: "can this instance correctly serve traffic right now." Checks
// the one dependency actually required to render a page (the database, via
// the resolver role — see `checkDatabaseHealth`'s own doc comment for why
// that role and not one of the pooled runtime connections). Deliberately
// does NOT check object storage: a storage outage breaks media delivery,
// not the ability to serve pages at all, so it shouldn't take this whole
// instance out of a load balancer's rotation — see docs/DEPLOYMENT.md.
export async function GET() {
  const database = await checkDatabaseHealth();
  const body = buildReadinessBody([{ name: "database", ok: database.ok }]);
  if (body.status !== "ok") {
    logger.warn("health.readiness_failed", { checks: body.checks });
  }
  return Response.json(body, { status: readinessHttpStatus(body) });
}
