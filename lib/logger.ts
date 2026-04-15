/**
 * Structured logger for server-side API routes and client-side hooks.
 *
 * - In production: emits JSON lines so log aggregators (Vercel Logs,
 *   Datadog, BetterStack, etc.) can parse them as structured records.
 * - In development: emits colour-coded console output with context prefix.
 * - Never throws — logging must never crash the caller.
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   const log = logger("api/players");
 *   log.error("upstream fetch failed", { status: res.status });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  context: string;
  msg: string;
  [key: string]: unknown;
}

const IS_PROD = process.env.NODE_ENV === "production";

function emit(level: LogLevel, context: string, msg: string, extra?: Record<string, unknown>): void {
  try {
    if (IS_PROD) {
      const entry: LogEntry = { ts: new Date().toISOString(), level, context, msg, ...extra };
      // eslint-disable-next-line no-console
      console[level === "debug" ? "log" : level](JSON.stringify(entry));
    } else {
      const prefix = `[${context}]`;
      const fn = level === "error" ? console.error
               : level === "warn"  ? console.warn
               : level === "debug" ? console.debug
               : console.log;
      extra ? fn(prefix, msg, extra) : fn(prefix, msg);
    }
  } catch {
    // Logging must never crash the caller
  }
}

export function logger(context: string) {
  return {
    debug: (msg: string, extra?: Record<string, unknown>) => emit("debug", context, msg, extra),
    info:  (msg: string, extra?: Record<string, unknown>) => emit("info",  context, msg, extra),
    warn:  (msg: string, extra?: Record<string, unknown>) => emit("warn",  context, msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => emit("error", context, msg, extra),
  };
}
