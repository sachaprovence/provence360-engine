import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createRequestLogger, generateRequestId, logger } from "./logger";

function parseLine(line: unknown): Record<string, unknown> {
  if (typeof line !== "string") throw new Error("expected a logged line");
  return JSON.parse(line) as Record<string, unknown>;
}

describe("logger", () => {
  let logSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("emits a single JSON line with time/level/message plus fields", () => {
    logger.info("something happened", { userId: "u1" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = parseLine(logSpy.mock.calls[0]?.[0]);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("something happened");
    expect(parsed.userId).toBe("u1");
    expect(typeof parsed.time).toBe("string");
  });

  it("redacts fields whose key looks like a secret, without dropping the rest", () => {
    logger.info("login attempt", {
      email: "alice@example.test",
      password: "hunter2",
      passwordHash: "$argon2id$...",
      sessionToken: "abc123",
    });

    const parsed = parseLine(logSpy.mock.calls[0]?.[0]);
    expect(parsed.email).toBe("alice@example.test");
    expect(parsed.password).toBe("[REDACTED]");
    expect(parsed.passwordHash).toBe("[REDACTED]");
    expect(parsed.sessionToken).toBe("[REDACTED]");
  });

  it("never crashes when no fields are passed", () => {
    expect(() => logger.info("no fields here")).not.toThrow();
  });
});

describe("generateRequestId", () => {
  it("produces a different id on every call", () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("createRequestLogger", () => {
  let logSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("attaches requestId/userId/tenantId to every call automatically", () => {
    const requestId = generateRequestId();
    const log = createRequestLogger({ requestId, userId: "u1", tenantId: "t1" });

    log.info("handling request");
    log.info("second call", { detail: "x" });

    for (const call of logSpy.mock.calls) {
      const parsed = parseLine(call[0]);
      expect(parsed.requestId).toBe(requestId);
      expect(parsed.userId).toBe("u1");
      expect(parsed.tenantId).toBe("t1");
    }
    expect(parseLine(logSpy.mock.calls[1]?.[0]).detail).toBe("x");
  });

  it("still redacts sensitive fields on a bound logger, including on the error level", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = createRequestLogger({ requestId: generateRequestId() });
    log.error("login failed", { token: "raw-token-value" });

    const parsed = parseLine(errorSpy.mock.calls[0]?.[0]);
    expect(parsed.token).toBe("[REDACTED]");
    errorSpy.mockRestore();
  });
});
