// v1.0 — brief §8: shared response-shape logic for both apps' `/health/live`
// and `/health/ready` routes, so the two apps stay identical in what they
// report rather than each growing its own slightly-different JSON shape.
// Deliberately dependency-free (no DB access here) — each app's route
// handler runs its own checks (e.g. `checkDatabaseHealth` from
// `@provence360/database`) and hands the results in, so this package never
// needs to depend on `@provence360/database` for this.

export interface LivenessBody {
  status: "ok";
}

/** The process is up and able to respond at all — never fails because a dependency is down. */
export function buildLivenessBody(): LivenessBody {
  return { status: "ok" };
}

export interface ReadinessDependency {
  name: string;
  ok: boolean;
}

export interface ReadinessBody {
  status: "ok" | "degraded";
  checks: Record<string, "ok" | "failed">;
}

/**
 * "Can this instance correctly serve traffic right now." Never includes a
 * dependency's own error detail (connection strings, stack traces) —
 * `dependencies` is expected to already be reduced to a plain ok/not-ok per
 * check by the caller (see `checkDatabaseHealth`'s own `error` field, which
 * itself never carries anything sensitive).
 */
export function buildReadinessBody(dependencies: ReadinessDependency[]): ReadinessBody {
  const checks: Record<string, "ok" | "failed"> = {};
  let allOk = true;
  for (const dependency of dependencies) {
    checks[dependency.name] = dependency.ok ? "ok" : "failed";
    if (!dependency.ok) allOk = false;
  }
  return { status: allOk ? "ok" : "degraded", checks };
}

/** HTTP status a readiness route should respond with for a given body — 503 is what tells a load balancer/orchestrator to stop routing here. */
export function readinessHttpStatus(body: ReadinessBody): number {
  return body.status === "ok" ? 200 : 503;
}
