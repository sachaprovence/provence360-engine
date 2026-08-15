// Liveness endpoint for infrastructure (container orchestrators, load
// balancers) and for Playwright's webServer readiness check
// (playwright.config.ts) — deliberately host-agnostic, unlike "/" which
// 404s for any Host that isn't a seeded, active domain.
export function GET() {
  return Response.json({ status: "ok" });
}
