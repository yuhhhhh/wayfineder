import { redactValue } from "./redaction.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function createJsonLogger(minimumLevel: LogLevel = "info"): Logger {
  const levels: LogLevel[] = ["debug", "info", "warn", "error"];
  const minimumIndex = levels.indexOf(minimumLevel);

  const write = (level: LogLevel, event: string, fields: Record<string, unknown> = {}) => {
    if (levels.indexOf(level) < minimumIndex) return;
    const sanitizedFields = redactValue(fields) as Record<string, unknown>;
    const line = JSON.stringify({
      ...sanitizedFields,
      timestamp: new Date().toISOString(),
      level,
      event,
    });
    const destination = level === "error" ? process.stderr : process.stdout;
    destination.write(`${line}\n`);
  };

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}
