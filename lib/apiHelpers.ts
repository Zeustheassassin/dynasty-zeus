import { NextResponse } from "next/server";

// ── Standard API error response ───────────────────────────────────────────────
// All API routes use this shape for error responses so clients can handle them
// generically. The `data` field optionally carries a safe empty payload so
// callers that don't check status codes still get a usable fallback.

export interface ApiErrorBody {
  error: string;
  code?: string;
}

export function apiError(
  message: string,
  status: number,
  code?: string
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
}

// ── Common validation helpers ─────────────────────────────────────────────────

/** Sleeper IDs are Discord-style snowflakes — numeric strings up to 20 digits.
 *  (64-bit unsigned integers have at most 20 decimal digits; 19 is common for recent IDs.) */
export const SLEEPER_ID_RE = /^\d{1,20}$/;

/** Validate a single Sleeper ID string. */
export function isValidSleeperId(id: string | null | undefined): id is string {
  return typeof id === "string" && SLEEPER_ID_RE.test(id);
}

/** Clamp a numeric query param to [min, max], returning null if invalid. */
export function parseIntParam(
  value: string | null | undefined,
  min: number,
  max: number
): number | null {
  if (value == null) return null;
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}
