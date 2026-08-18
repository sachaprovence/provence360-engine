import { buildLivenessBody } from "@provence360/observability";

// Pre-v1.0 liveness endpoint, kept for Playwright's webServer readiness
// check (playwright.config.ts) — deliberately host-agnostic, unlike "/"
// which 404s for any Host that isn't a seeded, active domain. v1.0 added
// the canonical `/health/live` (identical body, see that route) for real
// deployments; this one stays so nothing that already points at it breaks.
export function GET() {
  return Response.json(buildLivenessBody());
}
