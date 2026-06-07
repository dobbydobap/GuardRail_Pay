/**
 * Minimal structured logger — emits one JSON line per event so logs are
 * machine-parseable in production. No dependencies.
 *
 *   log.info("request", { method, path, status, ms })
 *   log.error("route.error", { path, error })
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Minimum level to emit; override with LOG_LEVEL=debug|info|warn|error. */
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL as LogLevel) ?? "info"] ?? LEVELS.info;

function emit(level: LogLevel, event: string, fields: Record<string, unknown>): void {
  if (LEVELS[level] < MIN_LEVEL) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields: Record<string, unknown> = {}) => emit("debug", event, fields),
  info: (event: string, fields: Record<string, unknown> = {}) => emit("info", event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}) => emit("warn", event, fields),
  error: (event: string, fields: Record<string, unknown> = {}) => emit("error", event, fields),
};
