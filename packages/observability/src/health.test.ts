import { describe, expect, it } from "vitest";
import { buildLivenessBody, buildReadinessBody, readinessHttpStatus } from "./health";

describe("buildLivenessBody", () => {
  it("is always ok — liveness never depends on anything external", () => {
    expect(buildLivenessBody()).toEqual({ status: "ok" });
  });
});

describe("buildReadinessBody / readinessHttpStatus", () => {
  it("reports ok with 200 when every dependency is ok", () => {
    const body = buildReadinessBody([{ name: "database", ok: true }]);
    expect(body).toEqual({ status: "ok", checks: { database: "ok" } });
    expect(readinessHttpStatus(body)).toBe(200);
  });

  it("reports degraded with 503 when any dependency fails", () => {
    const body = buildReadinessBody([
      { name: "database", ok: false },
      { name: "config", ok: true },
    ]);
    expect(body).toEqual({ status: "degraded", checks: { database: "failed", config: "ok" } });
    expect(readinessHttpStatus(body)).toBe(503);
  });

  it("degraded if ANY dependency fails, even among several", () => {
    const body = buildReadinessBody([
      { name: "a", ok: true },
      { name: "b", ok: true },
      { name: "c", ok: false },
    ]);
    expect(body.status).toBe("degraded");
  });

  it("never carries anything beyond ok/failed per named check — no error detail, no secrets", () => {
    const body = buildReadinessBody([{ name: "database", ok: false }]);
    expect(JSON.stringify(body)).not.toMatch(/postgresql:|password|secret/i);
  });
});
