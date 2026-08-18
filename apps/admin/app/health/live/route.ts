import { buildLivenessBody } from "@provence360/observability";

// See apps/web/app/health/live/route.ts for the full rationale (identical
// here): liveness never checks a dependency.
export function GET() {
  return Response.json(buildLivenessBody());
}
