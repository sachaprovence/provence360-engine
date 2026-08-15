type Level = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function write(level: Level, message: string, fields?: LogFields): void {
  const entry = { time: new Date().toISOString(), level, message, ...fields };
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
