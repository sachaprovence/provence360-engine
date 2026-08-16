import { randomUUID } from "node:crypto";

type Level = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

// Defense in depth against the one mistake that matters most in a log
// line: a field name that *looks* like it might carry a secret gets its
// value replaced rather than trusted to the caller's judgement. This is a
// safety net, not the primary control — the primary control is "don't
// pass a password/token/cookie to the logger in the first place," same as
// every other place in this codebase that handles one (see
// docs/SECURITY.md).
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /password|token|secret|cookie|hash|authorization/i;

function redact(fields: LogFields | undefined): LogFields | undefined {
  if (!fields) return fields;
  let hasSensitiveKey = false;
  for (const key of Object.keys(fields)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      hasSensitiveKey = true;
      break;
    }
  }
  if (!hasSensitiveKey) return fields;

  const redacted: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    redacted[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : value;
  }
  return redacted;
}

function write(level: Level, message: string, fields?: LogFields): void {
  const entry = { time: new Date().toISOString(), level, message, ...redact(fields) };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Minimal structured (JSON-lines) logger. A real backend (OTel, etc.) is deferred — see ROADMAP. */
export const logger = {
  debug: (message: string, fields?: LogFields) => write("debug", message, fields),
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};

export type Logger = typeof logger;

/** A fresh, random correlation id for one incoming request. */
export function generateRequestId(): string {
  return randomUUID();
}

export interface RequestLogContext {
  requestId: string;
  userId?: string;
  tenantId?: string;
}

/**
 * A logger bound to one request's correlation context — every call
 * automatically carries `requestId` (and `userId`/`tenantId` once known),
 * so grepping/filtering by any one of them reconstructs the full request
 * across every log line it produced, without every call site having to
 * remember to pass them individually.
 */
export function createRequestLogger(context: RequestLogContext): Logger {
  const bind =
    (level: Level) =>
    (message: string, fields?: LogFields): void =>
      write(level, message, { ...context, ...fields });

  return {
    debug: bind("debug"),
    info: bind("info"),
    warn: bind("warn"),
    error: bind("error"),
  };
}
