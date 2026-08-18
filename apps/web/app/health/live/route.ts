import { buildLivenessBody } from "@provence360/observability";

// Liveness: "is the process up at all." Never checks a dependency — a
// database or storage outage must never make this route (and therefore an
// orchestrator's restart policy) think the *process itself* is unhealthy.
// See docs/DEPLOYMENT.md and `/health/ready` for the readiness half.
export function GET() {
  return Response.json(buildLivenessBody());
}
